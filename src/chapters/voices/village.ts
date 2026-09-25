import * as THREE from 'three'
import { P, sprite } from '../../kit/pixel'
import { rng } from '../../core/math'
import { isInsideLogo } from '../../logo/logo'
import { nextFrame } from '../../core/yield'
import { Buf, SH, TOP_DOWN, Vox, lin, place, voxMaterial, type EmitOpts } from './vox'
import { EL, STOPS, npcSpot, roadSegments } from './path'

/*
 * The Side Quests village: a tile map (grass, a sandy road, a stream with a
 * bridge, a cobbled plaza), voxel houses facing the camera, a set piece behind
 * each villager (building site, taffy stall, gym yard, vineyard, glass
 * workshop, schoolhouse, a hero's house, a little software office), trees,
 * fences and flowers, and a treasure chest by the last stop that pops open
 * once every quest is done. Everything static merges into two draw calls
 * (ground + props), keeping only the faces the fixed top-down camera can see,
 * merged into rectangles; the living bits (water, chimney smoke, fountain,
 * butterflies, glints, the chest) are stepped at sprite frame rates.
 */

export const X0 = -19
export const X1 = 19
export const Z0 = -58
export const Z1 = 19
const COLS = X1 - X0 + 1
const ROWS = Z1 - Z0 + 1

const enum T {
  Grass = 0,
  Path = 1,
  Water = 2,
  Plaza = 3,
  Mat = 4,
  Soil = 5,
}

/** ground heights */
const GH = 0.07
const WH = -0.34

const PATH = P.cream
const PATH_DOT = P.gold

/** world-fixed props: only faces the top-down camera can see, merged into rectangles */
const FIXED: EmitOpts = { skip: TOP_DOWN, merge: true }

/** the reward chest, just east of the last stop (world xz of its centre) */
export const CHEST = new THREE.Vector2(6.2, -42.1)
const CV = 0.1
/** blinkers and glints come alive for this long after each beat change, then rest lit / off */
const BLINK_T = 4
const GLINT_T = 5

/** 5 x 7 capitals for the gate's nameplate (hand-set, so no font has to load) */
const GLYPHS: Record<string, string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
}

/** a wooden nameplate: void edge, orange frame, brown board, cream capitals with a void drop shadow */
function plateRows(text: string) {
  const glyphs = [...text].map(ch => GLYPHS[ch] ?? GLYPHS[' '])
  const tw = glyphs.reduce((w, g) => w + g[0].length, 0) + glyphs.length - 1
  const W = tw + 8
  const H = 13
  const g: string[][] = []
  for (let y = 0; y < H; y++)
    g.push([...Array(W)].map((_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 'k' : x === 1 || y === 1 || x === W - 2 || y === H - 2 ? 'o' : 'b')))
  let cx = 4
  for (const gl of glyphs) {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < gl[y].length; x++) {
        if (gl[y][x] !== '#') continue
        g[3 + y][cx + x] = 'c'
        if (g[4 + y][cx + x] === 'b') g[4 + y][cx + x] = 'k'
      }
    cx += gl[0].length + 1
  }
  // corner pixels off, for a rounded board
  g[0][0] = g[0][W - 1] = g[H - 1][0] = g[H - 1][W - 1] = '.'
  return g.map(r => r.join(''))
}

interface HouseOpts {
  /** west edge and front (south) edge, in world units */
  x0: number
  zf: number
  w: number
  d: number
  wall?: string
  roof: string
  trim?: string
  /** wall height in 0.25 cells */
  wallH?: number
  door?: number
  windows?: number[]
  chimney?: number | null
  flat?: boolean
  flowers?: boolean
}

export class Village {
  group = new THREE.Group()
  /** smoke emitters (chimney tops) */
  private chimneys: THREE.Vector3[] = []
  private smoke!: THREE.InstancedMesh
  private waterMat: THREE.ShaderMaterial
  private drops!: THREE.InstancedMesh
  private fountainTop = new THREE.Vector3()
  private flies: { a: THREE.Mesh; b: THREE.Mesh; home: THREE.Vector3; seed: number }[] = []
  private glints: { m: THREE.Mesh; seed: number }[] = []
  private blink: THREE.Mesh[] = []
  /** beat the story was on last frame, and when it changed (finite ambient blinks) */
  private beat = -99
  private beatAt = 0
  private lid!: THREE.Group
  private prize!: THREE.Mesh
  private sparks: THREE.Mesh[] = []
  private hens: { m: THREE.Mesh; home: THREE.Vector3; seed: number; span: number }[] = []
  private shade = new Buf()
  private type = new Uint8Array(COLS * ROWS)
  private busy = new Uint8Array(COLS * ROWS)
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private col = new THREE.Color()

  constructor(private mobile: boolean) {
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: lin(P.blue).clone() },
        uLight: { value: lin(P.cyan).clone() },
        uFoam: { value: lin(P.white).clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uDeep, uLight, uFoam;
        varying vec3 vW;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        void main() {
          // ripples: short dashes on a quarter-tile grid, drifting one step per frame (4 fps)
          float t = floor(uTime * 4.0);
          vec2 q = vec2(vW.x * 1.25 + t * 0.0625, vW.z * 4.0);
          vec2 c = floor(q);
          vec2 f = fract(q);
          float roll = floor(uTime * 0.9 + h21(c) * 3.0);
          float r = h21(c + roll * 7.13);
          float dash = step(0.78, r) * step(0.25, f.x) * step(f.x, 0.8) * step(0.42, f.y) * step(f.y, 0.62);
          float spark = step(0.965, r) * step(0.45, f.x) * step(f.x, 0.6) * step(0.42, f.y) * step(f.y, 0.62);
          vec3 col = mix(uDeep, uLight, dash);
          col = mix(col, uFoam, spark);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  }

  /* ------------------------------------------------------------ tile map */

  private idx(x: number, z: number) {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return -1
    return (z - Z0) * COLS + (x - X0)
  }
  tile(x: number, z: number): number {
    const i = this.idx(x, z)
    return i < 0 ? T.Grass : this.type[i]
  }
  private setTile(x: number, z: number, t: T) {
    const i = this.idx(x, z)
    if (i >= 0) this.type[i] = t
  }
  /** mark a world-space rectangle as occupied (no trees / flowers) */
  private reserve(xa: number, za: number, xb: number, zb: number) {
    for (let x = Math.floor(Math.min(xa, xb) + 0.5); x <= Math.round(Math.max(xa, xb)); x++)
      for (let z = Math.floor(Math.min(za, zb) + 0.5); z <= Math.round(Math.max(za, zb)); z++) {
        const i = this.idx(x, z)
        if (i >= 0) this.busy[i] = 1
      }
  }
  private height(t: number) {
    return t === T.Grass ? GH : t === T.Water ? WH : 0
  }

  private layout() {
    // road: 3 tiles wide along every straight run
    for (const [a, b] of roadSegments()) {
      const xa = Math.min(a.x, b.x)
      const xb = Math.max(a.x, b.x)
      const za = Math.min(a.y, b.y)
      const zb = Math.max(a.y, b.y)
      for (let x = Math.round(xa) - 1; x <= Math.round(xb) + 1; x++)
        for (let z = Math.round(za) - 1; z <= Math.round(zb) + 1; z++) this.setTile(x, z, T.Path)
    }
    // the stream, meandering west–east between the taffy stall and the gym
    for (let x = X0; x <= X1; x++) {
      const zc = -8.6 + 0.8 * Math.sin(x * 0.45 + 0.6)
      for (let z = Math.floor(zc - 1.2); z <= Math.ceil(zc + 1.2); z++) {
        if (Math.abs(z - zc) <= 1.0) this.setTile(x, z, T.Water)
      }
    }
    // cobbled plaza round the fountain
    for (let x = -1; x <= 6; x++)
      for (let z = -25; z <= -18; z++) {
        if (Math.hypot(x - 2.5, (z + 21.5) * 1.05) <= 2.75 && this.tile(x, z) === T.Grass) this.setTile(x, z, T.Plaza)
      }
    // gym mat + vineyard soil
    for (let x = -1; x <= 3; x++) for (let z = -16; z <= -15; z++) this.setTile(x, z, T.Mat)
    for (let x = 5; x <= 11; x++) for (let z = -26; z <= -21; z++) this.setTile(x, z, T.Soil)
    for (let i = 0; i < this.type.length; i++) if (this.type[i] !== T.Grass) this.busy[i] = 1
  }

  /* -------------------------------------------------------------- ground */

  private ground(b: Buf, detail: Vox, water: Buf) {
    const r = rng(11)
    for (let z = Z0; z <= Z1; z++)
      for (let x = X0; x <= X1; x++) {
        const t = this.tile(x, z)
        const h = this.height(t)
        const x0 = x - 0.5
        const x1 = x + 0.5
        const z0 = z - 0.5
        const z1 = z + 0.5
        if (t === T.Water) {
          water.top(x0, z0, x1, z1, WH, P.blue)
          // foam where the far bank meets the water
          if (this.tile(x, z - 1) !== T.Water) b.top(x0, z0, x1, z0 + 0.09, WH + 0.004, P.cyan)
          continue
        }
        if (t === T.Plaza) {
          b.top(x0, z0, x1, z1, h, P.slate)
          for (let j = 0; j < 2; j++) {
            const off = (z * 2 + j) & 1 ? 0.25 : 0
            for (let i = -1; i < 2; i++) {
              const ca = Math.max(x0 + 0.04, x0 + off + i * 0.5 + 0.04)
              const cb = Math.min(x1 - 0.04, x0 + off + i * 0.5 + 0.46)
              if (cb - ca < 0.08) continue
              const cz = z0 + j * 0.5 + 0.04
              const lit = (Math.abs(x * 7 + z * 13 + i * 3 + j * 5) % 5) === 0
              b.top(ca, cz, cb, cz + 0.42, h + 0.012, lit ? P.cream : P.steel)
            }
          }
        } else {
          const color = t === T.Grass ? P.green : t === T.Path ? PATH : t === T.Mat ? P.slate : P.brown
          b.top(x0, z0, x1, z1, h, color)
        }
        // south / east / west faces down to lower neighbours
        const sides: [number, number][] = [
          [0, 1],
          [1, 0],
          [-1, 0],
        ]
        for (const [dx, dz] of sides) {
          const nt = this.tile(x + dx, z + dz)
          const nh = this.height(nt)
          if (nh >= h) continue
          const lip = t === T.Grass ? P.pine : t === T.Path ? P.steel : P.slate
          const segs: [number, number, string][] = [[Math.max(nh, 0), h, lip]]
          if (nh < 0) segs.push([nh, Math.min(0, h), P.brown])
          for (const [ya, yb, c] of segs) {
            if (yb - ya < 1e-4) continue
            if (dz === 1) {
              _a.set(x0, ya, z1)
              _b.set(x1, ya, z1)
              _c.set(x1, yb, z1)
              _d.set(x0, yb, z1)
            } else if (dx === 1) {
              _a.set(x1, ya, z0)
              _b.set(x1, yb, z0)
              _c.set(x1, yb, z1)
              _d.set(x1, ya, z1)
            } else {
              _a.set(x0, ya, z0)
              _b.set(x0, ya, z1)
              _c.set(x0, yb, z1)
              _d.set(x0, yb, z0)
            }
            b.quad(_a, _b, _c, _d, c)
          }
        }
        // surface detail on a 0.1 grid: grass tufts, road pebbles, soil furrows
        const gx = Math.round(x * 10)
        const gz = Math.round(z * 10)
        if (t === T.Grass && !this.busy[this.idx(x, z)]) {
          if (r() < 0.42) {
            const tx = gx - 3 + Math.floor(r() * 6)
            const tz = gz - 3 + Math.floor(r() * 6)
            detail.set(tx, 0, tz, P.pine)
            detail.set(tx + 2, 0, tz, P.pine)
            detail.set(tx + 1, 0, tz + 1, P.pine)
          }
        } else if (t === T.Path) {
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            if (this.tile(x + dx, z + dz) !== T.Grass) continue
            const n = 1 + Math.floor(r() * 3)
            for (let k = 0; k < n; k++) {
              const along = -0.4 + Math.floor(r() * 7) * 0.1
              const depth = 0.1 + Math.floor(r() * 2) * 0.1
              const len = 0.1 + Math.floor(r() * 3) * 0.1
              if (dx !== 0) {
                const ex = dx > 0 ? x1 - depth : x0
                b.top(ex, z + along, ex + depth, z + along + len, 0.004, P.green)
              } else {
                const ez = dz > 0 ? z1 - depth : z0
                b.top(x + along, ez, x + along + len, ez + depth, 0.004, P.green)
              }
            }
          }
          const dot = (c: string) => {
            const px = x0 + 0.1 + Math.floor(r() * 7) * 0.1
            const pz = z0 + 0.1 + Math.floor(r() * 7) * 0.1
            b.top(px, pz, px + 0.1, pz + 0.1, 0.006, c)
          }
          if (r() < 0.3) dot(PATH_DOT)
          if (r() < 0.14) dot(P.steel)
        } else if (t === T.Soil) {
          for (let i = 0; i < 3; i++) b.top(x0 + 0.05, z0 + 0.12 + i * 0.33, x1 - 0.05, z0 + 0.2 + i * 0.33, 0.006, P.night)
        }
      }
  }

  /** flowers along the road and in beds */
  private flowers(detail: Vox) {
    const r = rng(23)
    const cols = [P.white, P.gold, P.coral, P.magenta, P.cyan]
    for (let z = Z0; z <= Z1; z++)
      for (let x = X0; x <= X1; x++) {
        const i = this.idx(x, z)
        if (this.type[i] !== T.Grass || this.busy[i]) continue
        const near = this.nearRoad(x, z, 2)
        if (!near || r() > 0.34) continue
        const n = 1 + Math.floor(r() * 3)
        const c = cols[Math.floor(r() * cols.length)]
        for (let k = 0; k < n; k++) {
          const fx = Math.round(x * 10) - 3 + Math.floor(r() * 6)
          const fz = Math.round(z * 10) - 3 + Math.floor(r() * 6)
          detail.set(fx, 0, fz, P.gold)
          detail.set(fx - 1, 0, fz, c)
          detail.set(fx + 1, 0, fz, c)
          detail.set(fx, 0, fz - 1, c)
          detail.set(fx, 0, fz + 1, c)
        }
      }
  }

  private nearRoad(x: number, z: number, d: number) {
    for (let dx = -d; dx <= d; dx++)
      for (let dz = -d; dz <= d; dz++) {
        const t = this.tile(x + dx, z + dz)
        if (t === T.Path || t === T.Plaza) return true
      }
    return false
  }

  /* -------------------------------------------------------------- houses */

  private house(b: Buf, o: HouseOpts) {
    const V = 0.25
    const W = Math.round(o.w * 4)
    const D = Math.round(o.d * 4)
    const H = o.wallH ?? 7
    const wall = o.wall ?? P.cream
    const trim = o.trim ?? P.brown
    const walls = new Vox()
    walls.box(0, 0, 0, W - 1, H - 1, D - 1, wall)
    walls.paint(0, 0, 0, W - 1, 0, D - 1, P.slate)
    if (!o.flat) {
      walls.paint(0, 1, D - 1, 0, H - 1, D - 1, trim)
      walls.paint(W - 1, 1, D - 1, W - 1, H - 1, D - 1, trim)
      walls.paint(0, H - 1, D - 1, W - 1, H - 1, D - 1, trim)
    }
    const dx = o.door ?? Math.floor(W / 2) - 1
    walls.paint(dx, 1, D - 1, dx + 1, 4, D - 1, P.brown)
    walls.paint(dx - 1, 5, D - 1, dx + 2, 5, D - 1, trim)
    walls.box(dx - 1, 0, D, dx + 2, 0, D, P.steel)
    walls.set(dx + 1, 2, D, P.gold)
    const wins = o.windows ?? (W >= 16 ? [2, W - 4] : [2])
    for (const wx of wins) {
      walls.paint(wx, 2, D - 1, wx + 1, 4, D - 1, P.cyan)
      walls.paint(wx, 4, D - 1, wx, 4, D - 1, P.white)
      walls.box(wx - 1, 1, D, wx + 2, 1, D, trim)
      if (o.flowers !== false) {
        walls.set(wx - 1, 2, D, P.coral)
        walls.set(wx, 2, D, P.green)
        walls.set(wx + 1, 2, D, P.gold)
        walls.set(wx + 2, 2, D, P.green)
      }
    }
    const m = place(o.x0, 0, o.zf - o.d)
    walls.emit(b, V, { ...FIXED, m })

    const roof = new Vox()
    let top = H
    if (o.flat) {
      roof.box(-1, H, -1, W, H, D, o.roof)
      roof.box(0, H + 1, 0, W - 1, H + 1, D - 1, o.roof)
      roof.paint(1, H + 1, 1, W - 2, H + 1, D - 2, P.slate)
      top = H + 2
    } else {
      for (let i = 0; ; i++) {
        const za = -1 + i * 2
        const zb = D - i * 2
        if (za > zb) break
        roof.box(-1, H + i, za, W, H + i, zb, o.roof)
        top = H + i + 1
      }
      // ridge cap
      roof.paint(-1, top - 1, 0, W, top - 1, D, SH[o.roof] ?? o.roof)
    }
    if (o.chimney != null) {
      const cz = Math.floor(D / 2) - 2
      roof.box(o.chimney, H, cz, o.chimney + 1, top + 1, cz + 1, P.slate)
      roof.box(o.chimney, top + 1, cz, o.chimney + 1, top + 1, cz + 1, P.steel)
      this.chimneys.push(new THREE.Vector3(o.x0 + (o.chimney + 1) * V, (top + 2) * V, o.zf - o.d + (cz + 1) * V))
    }
    roof.emit(b, V, { ...FIXED, m, ramp: 'roof' })
    this.reserve(o.x0 - 0.3, o.zf - o.d - 0.3, o.x0 + o.w + 0.3, o.zf + 0.4)
  }

  /* -------------------------------------------------------------- nature */

  private roundTree(apples: boolean, seed: number) {
    const v = new Vox()
    const r = rng(seed)
    v.box(-1, 0, -1, 0, 2, 0, P.brown)
    const R = 3.1
    const RY = 2.5
    for (let x = -4; x <= 3; x++)
      for (let y = 2; y <= 8; y++)
        for (let z = -4; z <= 3; z++) {
          const cx = x + 0.5
          const cy = y + 0.5 - 5
          const cz = z + 0.5
          const d = (cx * cx) / (R * R) + (cy * cy) / (RY * RY) + (cz * cz) / (R * R)
          if (d > 1) continue
          if (d > 0.82 && r() < 0.35) continue
          const lit = (-0.55 * cx + 1.0 * cy + 0.45 * cz) / Math.max(0.5, Math.hypot(cx, cy, cz))
          let c = lit > 0.42 ? P.green : P.pine
          if (apples && d > 0.7 && cy > -1 && r() < 0.12) c = P.coral
          v.set(x, y, z, c)
        }
    return v
  }

  private pineTree() {
    const v = new Vox()
    v.box(-1, 0, -1, 0, 1, 0, P.brown)
    const radii = [3.1, 2.6, 1.9, 2.6, 2.0, 1.4, 1.9, 1.3, 0.8, 0.5]
    radii.forEach((rad, i) => {
      const y = 2 + i
      for (let x = -4; x <= 3; x++)
        for (let z = -4; z <= 3; z++) {
          const cx = x + 0.5
          const cz = z + 0.5
          if (cx * cx + cz * cz > rad * rad) continue
          const topOfTier = i === 2 || i === 5 || i === 8 || i === 9
          v.set(x, y, z, topOfTier && cx - cz < 0.6 ? P.green : P.pine)
        }
    })
    return v
  }

  private bush(seed: number) {
    const v = new Vox()
    const r = rng(seed)
    for (let x = -3; x <= 2; x++)
      for (let y = 0; y <= 3; y++)
        for (let z = -3; z <= 2; z++) {
          const cx = x + 0.5
          const cy = y + 0.5 - 1
          const cz = z + 0.5
          const d = (cx * cx) / 7 + (cy * cy) / 5 + (cz * cz) / 7
          if (d > 1) continue
          let c = cy > 0.2 && cx < 0.6 ? P.green : P.pine
          if (d > 0.6 && cy > 0 && r() < 0.14) c = r() < 0.5 ? P.cream : P.magenta
          v.set(x, y, z, c)
        }
    return v
  }

  private scatterTrees(b: Buf) {
    const r = rng(this.mobile ? 5 : 7)
    const round = [this.roundTree(false, 3), this.roundTree(true, 4), this.roundTree(false, 9)]
    const pine = this.pineTree()
    const bushes = [this.bush(12), this.bush(13)]
    const planted = new Uint8Array(COLS * ROWS)
    const reach = this.mobile ? 13 : 19
    for (let z = Z0; z <= Z1; z++)
      for (let x = X0; x <= X1; x++) {
        if (Math.abs(x) > reach) continue
        const i = this.idx(x, z)
        if (this.type[i] !== T.Grass || this.busy[i]) continue
        let d = 9
        for (let dx = -4; dx <= 4; dx++)
          for (let dz = -4; dz <= 4; dz++) {
            const j = this.idx(x + dx, z + dz)
            if (j < 0) continue
            if (this.type[j] !== T.Grass || this.busy[j]) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dz)))
          }
        if (d < 2) continue
        const edge = Math.abs(x) >= 11 || z <= -50 || z >= 14
        const p = edge ? 0.66 : d >= 4 ? 0.46 : d >= 3 ? 0.32 : 0.16
        if (r() > p) continue
        // keep canopies from interpenetrating
        let crowded = false
        for (let dx = -1; dx <= 1 && !crowded; dx++)
          for (let dz = -1; dz <= 1; dz++) {
            const j = this.idx(x + dx, z + dz)
            if (j >= 0 && planted[j]) crowded = true
          }
        if (crowded) continue
        planted[i] = 1
        const jx = (r() - 0.5) * 0.3
        const jz = (r() - 0.5) * 0.3
        const pick = r()
        const quarter = Math.floor(r() * 4)
        if (d === 2 && pick < 0.45) {
          bushes[Math.floor(r() * 2)].emit(b, 0.2, { ...FIXED, m: place(x + jx, GH, z + jz, quarter), ramp: 'soft' })
          this.blob(x + jx + 0.12, z + jz + 0.1, 0.55)
        } else if (pick < (edge ? 0.45 : 0.22)) {
          pine.emit(b, 0.25, { ...FIXED, m: place(x + jx, GH, z + jz, quarter), ramp: 'soft' })
          this.blob(x + jx + 0.2, z + jz + 0.15, 0.85)
        } else {
          round[Math.floor(r() * round.length)].emit(b, 0.25, { ...FIXED, m: place(x + jx, GH, z + jz, quarter), ramp: 'soft' })
          this.blob(x + jx + 0.25, z + jz + 0.15, 1.0)
        }
      }
  }

  /** a pixel-stepped oval shadow on the grass */
  private blob(x: number, z: number, r: number) {
    const rows = 5
    for (let i = 0; i < rows; i++) {
      const t = (i + 0.5) / rows * 2 - 1
      const w = Math.sqrt(Math.max(0, 1 - t * t)) * r
      const zz = z + t * r * 0.55
      const hh = (r * 0.55 * 2) / rows
      this.shade.top(x - w, zz - hh / 2, x + w, zz + hh / 2, GH + 0.004, P.void)
    }
  }

  /* ----------------------------------------------------------- set pieces */

  /** 0 · a building site: brick walls going up inside a timber scaffold */
  private site(b: Buf) {
    const V = 0.25
    const v = new Vox()
    // footprint 16 x 12 cells (x -1.5..2.5, z -4.5..-1.5)
    v.box(0, 0, 0, 15, 0, 11, P.steel)
    const brick = P.coral
    // walls at varied heights, a door gap in front
    for (let x = 0; x <= 15; x++) {
      const hFront = x < 5 ? 4 : x < 8 ? 0 : x < 12 ? 3 : 2
      if (hFront) v.box(x, 1, 11, x, hFront, 11, brick)
      v.box(x, 1, 0, x, 6 - (x > 10 ? 2 : 0), 0, brick)
    }
    for (let z = 0; z <= 11; z++) {
      v.box(0, 1, z, 0, 5, z, brick)
      v.box(15, 1, z, 15, z < 6 ? 4 : 2, z, brick)
    }
    // mortar courses
    for (let y = 2; y <= 6; y += 2) v.paint(0, y, 0, 15, y, 11, P.magenta)
    // scaffold: poles, a plank deck, cross braces
    for (const [x, z] of [
      [-1, 12],
      [16, 12],
      [-1, -1],
      [16, -1],
      [7, 12],
    ])
      v.box(x, 0, z, x, 9, z, P.brown)
    v.box(-1, 6, 12, 16, 6, 13, P.orange)
    v.box(-1, 6, -1, -1, 6, 12, P.orange)
    v.box(-1, 9, 12, 16, 9, 12, P.brown)
    // stacked planks and a brick pile out front
    v.box(12, 1, 13, 15, 1, 14, P.orange)
    v.box(12, 2, 13, 15, 2, 14, P.brown)
    v.box(1, 1, 13, 3, 2, 14, brick)
    v.set(2, 3, 13, brick)
    v.emit(b, V, { ...FIXED, m: place(-1.5, 0, -4.5) })
    this.reserve(-1.8, -4.8, 2.8, -1.0)
  }

  /** 1 · a salt water taffy stall by the stream */
  private stall(b: Buf) {
    const V = 0.125
    const v = new Vox()
    // counter (front at z = 8)
    v.box(1, 0, 3, 22, 6, 7, P.brown)
    for (let x = 1; x <= 22; x += 3) v.paint(x, 1, 7, x, 5, 7, P.orange)
    v.box(0, 7, 2, 23, 7, 8, P.cream)
    // taffy jars
    const jars = [P.magenta, P.cyan, P.gold, P.coral, P.white, P.magenta]
    jars.forEach((c, i) => {
      const x = 2 + i * 3.5
      v.box(Math.round(x), 8, 4, Math.round(x) + 1, 10, 5, c)
      v.box(Math.round(x), 11, 4, Math.round(x) + 1, 11, 5, P.white)
    })
    // posts
    for (const x of [0, 23]) {
      v.box(x, 0, 0, x, 18, 0, P.white)
      v.box(x, 8, 8, x, 16, 8, P.white)
    }
    // striped awning, stepping down toward the front, scalloped edge
    for (let z = -1; z <= 10; z++) {
      const y = 19 - Math.floor(((z + 1) * 3) / 11)
      for (let x = -1; x <= 24; x++) v.set(x, y, z, Math.floor((x + 1) / 3) % 2 ? P.cream : P.coral)
    }
    for (let x = -1; x <= 24; x += 2) v.set(x, 15, 10, Math.floor((x + 1) / 3) % 2 ? P.cream : P.coral)
    v.emit(b, V, { ...FIXED, m: place(-6.5, 0, -8.35) })
    this.reserve(-6.7, -8.4, -3.3, -6.9)
  }

  /** 2 · a gym yard: pull-up rig, kettlebells, a tractor tyre, a plyo box */
  private gym(b: Buf) {
    const V = 0.125
    const v = new Vox()
    for (const x of [2, 18, 34]) v.box(x, 0, 4, x, 17, 4, P.steel)
    v.box(2, 17, 4, 34, 17, 4, P.steel)
    v.box(2, 12, 4, 18, 12, 4, P.white)
    // kettlebells
    for (const [x, z, c] of [
      [6, 12, P.void],
      [11, 13, P.coral],
      [24, 12, P.void],
    ] as [number, number, string][]) {
      v.box(x, 0, z, x + 2, 2, z + 2, c)
      v.set(x, 3, z + 1, c)
      v.set(x + 2, 3, z + 1, c)
      v.box(x, 4, z + 1, x + 2, 4, z + 1, c)
    }
    // tyre
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const d = Math.hypot(x, z)
        if (d <= 5.4 && d >= 2.6) v.box(27 + x, 0, 10 + z, 27 + x, 1, 10 + z, P.night)
      }
    // plyo box
    v.box(12, 0, 0, 16, 4, 3, P.orange)
    v.emit(b, V, { ...FIXED, m: place(-1.3, 0, -16.6) })
    this.reserve(-1.4, -16.8, 3.8, -14.4)
  }

  /** 3 · a vineyard: trellis rows heavy with grapes, barrels by the road */
  private vineyard(b: Buf) {
    const V = 0.125
    const r = rng(31)
    const rows = [-21.3, -23.3, -25.3]
    for (const zr of rows) {
      const v = new Vox()
      const len = 48
      for (let x = 0; x <= len; x += 16) v.box(x, 0, 0, x, 9, 0, P.brown)
      v.box(0, 8, 0, len, 8, 0, P.brown)
      for (let x = 0; x <= len; x++) {
        const top = 6 + Math.floor(r() * 3)
        for (let y = 3; y <= top; y++) for (let z = -1; z <= 1; z++) if (r() < 0.8) v.set(x, y, z, y > 5 ? P.green : P.pine)
        if (x % 5 === 2) {
          v.box(x, 2, 1, x + 1, 4, 1, P.purple)
          v.set(x, 4, 2, P.magenta)
          v.set(x + 1, 3, 2, P.purple)
          v.set(x, 2, 2, P.purple)
        }
      }
      v.emit(b, V, { ...FIXED, m: place(4.9, GH * 0 + 0, zr) })
    }
    // barrels
    const barrel = new Vox()
    for (let x = -3; x <= 2; x++)
      for (let z = -3; z <= 2; z++) {
        if (Math.hypot(x + 0.5, z + 0.5) > 3) continue
        barrel.box(x, 0, z, x, 6, z, P.brown)
        barrel.set(x, 1, z, P.steel)
        barrel.set(x, 5, z, P.steel)
      }
    barrel.box(-1, 7, -1, 0, 7, 0, P.purple)
    barrel.emit(b, V, { ...FIXED, m: place(8.3, GH, -19.95) })
    barrel.emit(b, V, { ...FIXED, m: place(9.1, GH, -19.9) })
    barrel.emit(b, V, { ...FIXED, m: place(8.7, GH + 0.875, -19.95) })
    this.reserve(4.6, -26.2, 11.4, -20.3)
    this.reserve(7.7, -20.4, 9.7, -19.6)
  }

  /** 4 · a glass workshop with a display table of glowing pieces */
  private glassShop(b: Buf) {
    this.house(b, { x0: -3.5, zf: -26.6, w: 5, d: 3, wall: P.white, roof: P.blue, trim: P.slate, windows: [2, 14], chimney: 4, flowers: false })
    const V = 0.125
    const v = new Vox()
    v.box(0, 0, 0, 0, 4, 0, P.brown)
    v.box(9, 0, 0, 9, 4, 0, P.brown)
    v.box(0, 0, 4, 0, 4, 4, P.brown)
    v.box(9, 0, 4, 9, 4, 4, P.brown)
    v.box(-1, 5, -1, 10, 5, 5, P.brown)
    // vases
    v.box(1, 6, 1, 2, 9, 2, P.cyan)
    v.set(1, 10, 1, P.cyan)
    v.box(4, 6, 1, 5, 7, 3, P.magenta)
    v.set(4, 8, 2, P.magenta)
    v.box(7, 6, 1, 8, 8, 2, P.gold)
    v.box(7, 9, 1, 7, 10, 1, P.gold)
    v.emit(b, V, { ...FIXED, m: place(0.35, 0, -26.45) })
    this.reserve(0.2, -26.6, 1.7, -25.8)
    for (const [x, y, z] of [
      [0.55, 1.3, -26.2],
      [1.0, 1.05, -26.05],
      [1.3, 1.25, -26.25],
    ])
      this.glint(x, y, z)
  }

  /** 5 · the academy: a schoolhouse with a bell tower */
  private school(b: Buf) {
    this.house(b, { x0: -10.5, zf: -32.6, w: 8, d: 4, wall: P.cream, roof: P.coral, trim: P.purple, windows: [3, 8, 21, 26], chimney: null })
    const V = 0.25
    const v = new Vox()
    // bell tower on the ridge
    v.box(0, 0, 0, 3, 5, 3, P.white)
    v.box(1, 3, 3, 2, 4, 3, null)
    v.box(1, 3, 0, 2, 4, 0, null)
    v.box(1, 3, 1, 2, 4, 2, null)
    v.box(1, 3, 1, 2, 3, 2, P.gold)
    v.set(1, 4, 1, P.gold)
    for (let i = 0; i < 3; i++) v.box(-1 + i, 6 + i, -1 + i, 4 - i, 6 + i, 4 - i, P.coral)
    v.set(1, 9, 1, P.gold)
    v.emit(b, V, { ...FIXED, m: place(-7.0, 3.0, -35.1) })
    this.reserve(-10.8, -36.9, -2.2, -32.1)
  }

  /** 6 · the home hero's house: ladder up to the eaves, a toolbox, a paint can */
  private heroHouse(b: Buf) {
    this.house(b, { x0: -1.5, zf: -38.6, w: 5, d: 3, wall: P.white, roof: P.blue, trim: P.indigo, windows: [2, 14], chimney: 15 })
    const V = 0.125
    const v = new Vox()
    // ladder leaning on the wall (rails step back as they rise)
    for (let y = 0; y <= 15; y++) {
      const z = 4 - Math.floor(y / 4)
      v.set(0, y, z, P.orange)
      v.set(4, y, z, P.orange)
      if (y % 3 === 1) v.box(1, y, z, 3, y, z, P.brown)
    }
    v.emit(b, V, { ...FIXED, m: place(2.15, 0, -38.6) })
    const t = new Vox()
    t.box(0, 0, 0, 5, 2, 2, P.coral)
    t.box(0, 3, 1, 5, 3, 1, P.magenta)
    t.box(2, 4, 1, 3, 4, 1, P.steel)
    t.box(8, 0, 0, 10, 3, 2, P.white)
    t.box(8, 3, 0, 10, 3, 2, P.blue)
    t.emit(b, V, { ...FIXED, m: place(-1.25, 0, -38.35) })
    this.reserve(-1.8, -41.9, 3.8, -38.0)
  }

  /** 7 · a small software office with a glowing terminal and a rooftop antenna */
  private office(b: Buf) {
    this.house(b, { x0: 2.5, zf: -44.6, w: 5, d: 3, wall: P.white, roof: P.purple, trim: P.slate, windows: [2, 5, 13, 16], flat: true, flowers: false, wallH: 8, door: 9 })
    const V = 0.125
    const k = new Vox()
    // terminal kiosk
    k.box(0, 0, 0, 3, 7, 2, P.slate)
    k.box(0, 8, 0, 3, 10, 3, P.steel)
    k.box(1, 8, 4, 2, 9, 4, P.signal)
    k.emit(b, V, { ...FIXED, m: place(6.75, 0, -44.25) })
    // antenna
    const a = new Vox()
    a.box(0, 0, 0, 0, 7, 0, P.steel)
    a.box(-2, 7, 0, 2, 7, 0, P.steel)
    a.emit(b, V, { ...FIXED, m: place(3.4, 9 * 0.25 + 0.25, -46.4) })
    this.blinker(3.46, 9 * 0.25 + 0.25 + 1.02, -46.34, P.coral)
    this.blinker(6.94, 1.18, -43.7, P.signal, 0.9)
    this.reserve(2.2, -47.9, 7.8, -43.9)
  }

  /** the plaza fountain, crowned with the Hark mark in gold voxels */
  private fountain(b: Buf, water: Buf) {
    const V = 0.125
    const cx = 2.5
    const cz = -21.5
    const v = new Vox()
    for (let x = -11; x <= 10; x++)
      for (let z = -11; z <= 10; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5)
        if (d <= 11 && d >= 9) v.box(x, 0, z, x, 2, z, d > 10 ? P.steel : P.white)
        if (d < 9) v.set(x, 0, z, P.slate)
      }
    v.box(-2, 1, -2, 1, 6, 1, P.steel)
    v.box(-3, 7, -3, 2, 7, 2, P.white)
    v.emit(b, V, { ...FIXED, m: place(cx, 0, cz) })
    // water disc inside the basin
    const r = 9 * V
    for (let x = -9; x < 9; x++)
      for (let z = -9; z < 9; z++) {
        if (Math.hypot(x + 0.5, z + 0.5) > 9) continue
        water.top(cx + x * V, cz + z * V, cx + (x + 1) * V, cz + (z + 1) * V, 0.22, P.blue)
      }
    void r
    // the mark, voxelised from the logo outline
    const mark = new Vox()
    const N = 15
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const x = (i + 0.5) / N - 0.5
        const y = (j + 0.5) / N - 0.5
        if (isInsideLogo(x, y)) {
          mark.set(i, j, 0, P.gold)
          mark.set(i, j, 1, P.gold)
        }
      }
    mark.emit(b, 0.075, { ...FIXED, m: place(cx - (N * 0.075) / 2, 8 * V + 0.05, cz - 0.05) })
    this.fountainTop.set(cx, 1.1, cz)
    this.reserve(cx - 1.5, cz - 1.5, cx + 1.5, cz + 1.5)
  }

  /**
   * The village gate the player enters through: two stone posts topped with
   * lanterns, a timber beam across them, and a nameplate hung under it that
   * turns to face the (fixed) camera like a sprite would, so it stays legible.
   */
  private gate(b: Buf) {
    const V = 0.125
    const v = new Vox()
    for (const x of [0, 30]) {
      v.box(x, 0, 0, x + 3, 10, 3, P.steel)
      v.box(x, 0, 0, x + 3, 0, 3, P.slate)
      v.box(x - 1, 11, -1, x + 4, 11, 4, P.slate)
      // lantern
      v.box(x + 1, 12, 1, x + 2, 12, 2, P.night)
      v.box(x + 1, 13, 1, x + 2, 14, 2, P.gold)
      v.box(x, 15, 0, x + 3, 15, 3, P.night)
      v.box(x + 1, 16, 1, x + 2, 16, 2, P.night)
      // timber upright from the lantern cap to the beam
      v.box(x + 1, 17, 1, x + 2, 22, 2, P.brown)
    }
    v.box(-1, 22, 1, 34, 23, 2, P.brown)
    v.box(-1, 23, 1, 34, 23, 2, P.orange)
    v.emit(b, V, { ...FIXED, m: place(-2.2, 0, 4.2) })
    const plate = sprite(plateRows('SIDE QUESTS'), { k: P.void, o: P.orange, b: P.brown, c: P.cream }, { pixelSize: 0.05 })
    plate.rotation.x = -EL
    plate.position.set(-2.2 + 16.5 * V, 2.45, 4.2 + 2.6 * V)
    this.group.add(plate)
    this.blob(-1.85, 4.55, 0.35)
    this.blob(1.95, 4.55, 0.35)
    this.reserve(-2.4, 4.0, -1.6, 4.8)
    this.reserve(1.4, 4.0, 2.4, 4.8)
  }

  /**
   * The reward chest: wooden body with gold bands and a lock, a heap of gold
   * inside, and a hinged lid (its own mesh, so it can swing open). A heart
   * container and a few sparkles wait inside for the end of the level.
   */
  private chest(b: Buf) {
    const body = new Vox()
    body.box(0, 0, 0, 8, 4, 5, P.brown)
    for (const x of [1, 7]) body.paint(x, 0, 0, x, 4, 5, P.gold)
    // gold heaped inside (only seen once the lid is up)
    body.paint(1, 4, 1, 7, 4, 4, P.gold)
    body.paint(2, 4, 2, 6, 4, 3, P.orange)
    body.set(3, 4, 2, P.cream)
    body.set(5, 4, 3, P.cream)
    // lock plate
    body.box(3, 2, 6, 5, 4, 6, P.gold)
    body.set(4, 3, 6, P.void)
    const x0 = CHEST.x - 4.5 * CV
    const z0 = CHEST.y - 3 * CV
    body.emit(b, CV, { ...FIXED, m: place(x0, 0, z0) })
    this.blob(CHEST.x + 0.08, CHEST.y + 0.12, 0.55)

    // lid: a stepped arch, hinged along the back top edge
    const lid = new Vox()
    lid.box(0, 0, 0, 8, 0, 5, P.brown)
    lid.box(0, 1, 1, 8, 1, 4, P.brown)
    lid.box(0, 2, 2, 8, 2, 3, P.brown)
    for (const x of [1, 7]) lid.paint(x, 0, 0, x, 2, 5, P.gold)
    lid.box(3, 0, 6, 5, 0, 6, P.gold)
    // no face culling here: the lid swings round to show its inside
    const lm = new THREE.Mesh(lid.geometry(CV, { merge: true }), voxMaterial())
    this.lid = new THREE.Group()
    this.lid.add(lm)
    this.lid.position.set(x0, 5 * CV, z0)
    this.group.add(this.lid)

    // the heart container + sparkles (billboards, off until the chest opens)
    this.prize = sprite(
      ['.kk...kk.', 'kcck.kcck', 'kwcckccck', 'kwcccccck', '.kccccck.', '..kccck..', '...kck...', '....k....'],
      { k: P.void, c: P.coral, w: P.white },
      { pixelSize: 0.075 },
    )
    for (let i = 0; i < 3; i++)
      this.sparks.push(sprite(['..w..', '..w..', 'wwgww', '..w..', '..w..'], { w: P.white, g: P.gold }, { pixelSize: 0.05, glow: 1.3 }))
    for (const m of [this.prize, ...this.sparks]) {
      const mat = m.material as THREE.MeshBasicMaterial
      mat.depthTest = false
      m.renderOrder = 20
      m.visible = false
      this.group.add(m)
    }
    this.reserve(CHEST.x - 0.5, CHEST.y - 0.35, CHEST.x + 0.5, CHEST.y + 0.35)
  }

  /**
   * Chest state, a pure function of story progress: `open` 0..1 swings the lid
   * (three stepped frames), `rise` 0..1 lifts the heart out of it; sparkles pop
   * once while the heart rises. Reduced motion: no swing, no sparkles, the
   * chest simply stands open with the heart above it.
   */
  setChest(open: number, rise: number, calm: boolean, camera: THREE.Camera) {
    const o = calm ? (open > 0 ? 1 : 0) : Math.floor(open * 3 + 1e-6) / 3
    this.lid.rotation.x = -1.95 * o
    const r = calm ? (rise > 0 ? 1 : 0) : Math.floor(rise * 6 + 1e-6) / 6
    this.prize.visible = r > 0
    if (r > 0) {
      this.prize.position.set(CHEST.x, 0.6 + 1.5 * r, CHEST.y + 0.1)
      this.prize.scale.setScalar(r < 0.34 ? 0.6 : 1)
      this.prize.quaternion.copy(camera.quaternion)
    }
    for (let i = 0; i < this.sparks.length; i++) {
      const m = this.sparks[i]
      const p = (rise - i * 0.18) / 0.5
      const on = !calm && p > 0 && p < 1
      m.visible = on
      if (!on) continue
      const a = i * 2.1 + 0.6
      m.position.set(CHEST.x + Math.cos(a) * 0.55, 0.8 + 1.3 * r + Math.sin(a) * 0.35, CHEST.y + 0.15)
      m.scale.setScalar(p < 0.33 ? 0.6 : p < 0.66 ? 1 : 0.6)
      m.quaternion.copy(camera.quaternion)
    }
  }

  private fence(b: Buf, xa: number, za: number, xb: number, zb: number) {
    const V = 0.125
    const v = new Vox()
    const alongX = Math.abs(xb - xa) >= Math.abs(zb - za)
    const len = Math.round((alongX ? Math.abs(xb - xa) : Math.abs(zb - za)) / V)
    for (let i = 0; i <= len; i += 4) v.box(i, 0, 0, i, 5, 0, P.cream)
    v.box(0, 2, 0, len, 2, 0, P.cream)
    v.box(0, 4, 0, len, 4, 0, P.cream)
    const m = alongX ? place(Math.min(xa, xb), GH, za) : place(xa, GH, Math.max(za, zb), 1)
    v.emit(b, V, { ...FIXED, m })
  }

  private lamp(b: Buf, x: number, z: number) {
    const V = 0.125
    const v = new Vox()
    v.box(-1, 0, -1, 1, 1, 1, P.slate)
    v.box(0, 2, 0, 0, 11, 0, P.night)
    v.box(-1, 12, -1, 1, 13, 1, P.gold)
    v.box(-1, 14, -1, 1, 14, 1, P.night)
    v.emit(b, V, { ...FIXED, m: place(x, GH, z) })
    this.reserve(x - 0.3, z - 0.3, x + 0.3, z + 0.3)
  }

  private sign(b: Buf, x: number, z: number) {
    const V = 0.125
    const v = new Vox()
    v.box(0, 0, 0, 0, 6, 0, P.brown)
    v.box(-3, 5, 1, 3, 8, 1, P.orange)
    v.box(-2, 6, 2, 2, 7, 2, P.brown)
    v.emit(b, V, { ...FIXED, m: place(x, GH, z) })
    this.reserve(x - 0.4, z - 0.3, x + 0.4, z + 0.3)
  }

  private bridge(b: Buf) {
    // deck across every water tile the road crosses
    let xa = Infinity
    let xb = -Infinity
    let za = Infinity
    let zb = -Infinity
    for (const [a, c] of roadSegments()) {
      const lo = Math.round(Math.min(a.x, c.x)) - 1
      const hi = Math.round(Math.max(a.x, c.x)) + 1
      const zl = Math.round(Math.min(a.y, c.y)) - 1
      const zh = Math.round(Math.max(a.y, c.y)) + 1
      for (let x = lo; x <= hi; x++)
        for (let z = zl; z <= zh; z++) {
          const zc = -8.6 + 0.8 * Math.sin(x * 0.45 + 0.6)
          if (Math.abs(z - zc) <= 1.0) {
            xa = Math.min(xa, x)
            xb = Math.max(xb, x)
            za = Math.min(za, z)
            zb = Math.max(zb, z)
          }
        }
    }
    if (!Number.isFinite(xa)) return
    const V = 0.125
    const v = new Vox()
    const W = Math.round((xb - xa + 1) / V)
    const D = Math.round((zb - za + 1) / V) + 4
    for (let z = 0; z < D; z++) v.box(0, 0, z, W - 1, 0, z, z % 2 ? P.orange : P.brown)
    for (const x of [-1, W]) {
      for (let z = 0; z < D; z += 4) v.box(x, 0, z, x, 4, z, P.brown)
      v.box(x, 4, 0, x, 4, D - 1, P.orange)
    }
    v.emit(b, V, { ...FIXED, m: place(xa - 0.5, 0.02, za - 0.5 - 0.25), ramp: 'flat' })
  }

  /* ------------------------------------------------------------ animated */

  private glint(x: number, y: number, z: number) {
    const m = sprite(['..w..', '..w..', 'wwwww', '..w..', '..w..'], { w: P.white }, { pixelSize: 0.05, glow: 1.5 })
    m.position.set(x, y, z)
    ;(m.material as THREE.Material).depthTest = true
    this.group.add(m)
    this.glints.push({ m, seed: this.glints.length * 1.7 })
  }

  private blinker(x: number, y: number, z: number, c: string, size = 1) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.13 * size, 0.13 * size, 0.13 * size), new THREE.MeshBasicMaterial({ color: lin(c).clone().multiplyScalar(1.4), toneMapped: false }))
    m.position.set(x, y, z)
    this.group.add(m)
    this.blink.push(m)
  }

  private butterflies() {
    const n = this.mobile ? 3 : 6
    const homes = [
      [2.6, -1.0],
      [-3.0, -6.5],
      [3.2, -13.3],
      [4.2, -18.8],
      [-3.8, -30.2],
      [3.4, -36.8],
    ]
    const cols = [P.white, P.gold, P.cyan, P.coral, P.white, P.magenta]
    for (let i = 0; i < n; i++) {
      const map = { c: cols[i], k: P.void }
      const a = sprite(['c.c', 'ckc', 'c.c'], map, { pixelSize: 0.06 })
      const bb = sprite(['.k.', 'ckc', '.k.'], map, { pixelSize: 0.06 })
      const [hx, hz] = homes[i]
      this.group.add(a, bb)
      this.flies.push({ a, b: bb, home: new THREE.Vector3(hx, 0.7, hz), seed: i * 2.37 + 0.4 })
    }
  }

  /** a few hens pecking about the yards */
  private chickens() {
    const v = new Vox()
    v.box(-2, 1, -1, 1, 3, 1, P.white) // body
    v.box(-3, 3, -1, -3, 4, 1, P.white) // tail
    v.box(1, 3, 0, 2, 5, 0, P.white) // neck + head
    v.box(1, 3, -1, 2, 5, -1, P.white)
    v.set(2, 6, 0, P.coral) // comb
    v.set(2, 6, -1, P.coral)
    v.set(3, 4, 0, P.gold) // beak
    v.set(3, 4, -1, P.gold)
    v.set(2, 3, 1, P.coral) // wattle
    v.set(2, 5, 1, P.void) // eye
    v.set(2, 5, -2, P.void)
    v.box(-1, 0, 0, -1, 0, 0, P.gold) // legs
    v.box(0, 0, -1, 0, 0, -1, P.gold)
    const g = v.geometry(0.065, { ramp: 'soft', origin: [0, 0, -0.03] })
    const spots = [
      [-3.4, -2.2, 1.1],
      [3.4, -9.6 + 5.0, 0.9],
      [-3.6, -34.2 + 2.4, 1.0],
      [8.0, -34.6, 1.2],
    ]
    const n = this.mobile ? 2 : spots.length
    for (let i = 0; i < n; i++) {
      const [x, z, span] = spots[i]
      const m = new THREE.Mesh(g, voxMaterial())
      this.group.add(m)
      this.hens.push({ m, home: new THREE.Vector3(x, GH, z), seed: i * 3.1 + 0.7, span })
    }
  }

  /* --------------------------------------------------------------- build */

  async build() {
    this.layout()
    // reserve villager spots + the talk stops so nothing grows through them
    for (let k = 0; k < STOPS.length; k++) {
      const n = npcSpot(k)
      this.reserve(n.x - 0.6, n.y - 0.6, n.x + 0.6, n.y + 0.6)
    }
    const props = new Buf()
    const gate = () => this.gate(props)
    gate()
    this.site(props)
    this.stall(props)
    this.gym(props)
    this.vineyard(props)
    this.glassShop(props)
    this.school(props)
    this.heroHouse(props)
    this.office(props)
    this.chest(props)
    const water = new Buf()
    this.fountain(props, water)
    this.bridge(props)

    const houses: HouseOpts[] = [
      { x0: -12.5, zf: -1.2, w: 4, d: 3, roof: P.coral, chimney: 3 },
      { x0: 4.2, zf: -1.4, w: 4, d: 3, roof: P.blue, wall: P.white, trim: P.indigo, chimney: 12 },
      { x0: -7.4, zf: 6.8, w: 4, d: 3, roof: P.purple, chimney: 11 },
      { x0: 3.6, zf: 7.4, w: 4, d: 3, roof: P.magenta, wall: P.white, trim: P.purple },
      { x0: -7.8, zf: -11.8, w: 4, d: 3, roof: P.orange, trim: P.brown, chimney: 3 },
      { x0: 8.6, zf: -12.4, w: 4, d: 3, roof: P.coral, wall: P.white, chimney: 12 },
      { x0: 3.2, zf: -27.6, w: 4, d: 3, roof: P.blue, chimney: 3 },
      { x0: -13.2, zf: -20.2, w: 4, d: 3, roof: P.magenta, chimney: 12 },
      { x0: -13.4, zf: -27.4, w: 4, d: 3, roof: P.orange, wall: P.white, trim: P.brown },
      { x0: -7.6, zf: -38.4, w: 4, d: 3, roof: P.orange, chimney: 12 },
      { x0: 8.6, zf: -36.6, w: 4, d: 3, roof: P.purple, wall: P.white, trim: P.indigo, chimney: 3 },
      { x0: -4.2, zf: -44.6, w: 4, d: 3, roof: P.coral, chimney: 3 },
      { x0: 9.2, zf: -44.2, w: 4, d: 3, roof: P.magenta, chimney: 12 },
      { x0: -5.2, zf: -50.2, w: 5, d: 3, roof: P.blue, wall: P.white, chimney: 15 },
      { x0: 5.2, zf: -51.0, w: 4, d: 3, roof: P.coral, chimney: 3 },
    ]
    for (const h of houses) this.house(props, h)

    // little things by the road
    this.fence(props, 7.6, -20.65, 11.4, -20.65)
    this.fence(props, -4.4, 2.75, -1.8, 2.75)
    this.fence(props, 2.6, -5.9, 5.6, -5.9)
    this.fence(props, -12.2, -32.8, -12.2, -29.8)
    this.fence(props, -2.3, -47.9, -2.3, -45.6)
    this.lamp(props, 2.4, 2.8)
    this.lamp(props, -6.6, -3.4)
    this.lamp(props, 2.4, -10.6)
    this.lamp(props, 7.8, -16.4)
    this.lamp(props, -2.4, -22.6)
    this.lamp(props, -7.6, -28.2)
    this.lamp(props, 2.6, -34.4)
    this.lamp(props, 6.6, -40.2)
    this.sign(props, -2.2, 6.2)
    this.sign(props, 7.6, -13.6)
    this.sign(props, -7.6, -25.8)
    await nextFrame()

    const detail = new Vox()
    const ground = new Buf()
    this.ground(ground, detail, water)
    this.flowers(detail)
    detail.emit(ground, 0.1, { skip: TOP_DOWN, ramp: 'flat', origin: [0.05, -GH, 0.05] })
    await nextFrame()
    this.scatterTrees(props)
    await nextFrame()

    const mat = voxMaterial()
    const gMesh = new THREE.Mesh(ground.geometry(), mat)
    gMesh.frustumCulled = false
    const pMesh = new THREE.Mesh(props.geometry(), mat)
    pMesh.frustumCulled = false
    const wMesh = new THREE.Mesh(water.geometry(), this.waterMat)
    wMesh.frustumCulled = false
    const sMesh = new THREE.Mesh(this.shade.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }))
    sMesh.frustumCulled = false
    sMesh.renderOrder = 1
    this.group.add(gMesh, wMesh, sMesh, pMesh)

    // chimney smoke: one instanced draw
    const per = 3
    this.smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), this.chimneys.length * per)
    this.smoke.frustumCulled = false
    for (let i = 0; i < this.smoke.count; i++) this.smoke.setColorAt(i, lin(P.white))
    this.group.add(this.smoke)

    // fountain spray
    this.drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), new THREE.MeshBasicMaterial({ color: lin(P.cyan), toneMapped: false }), 10)
    this.drops.frustumCulled = false
    this.group.add(this.drops)

    this.butterflies()
    this.chickens()
  }

  /* -------------------------------------------------------------- update */

  /** `beat`: the story beat on screen (ambient blinks wake for a few seconds when it changes) */
  update(time: number, calm: boolean, camera: THREE.Camera, beat: number) {
    const t = calm ? 0 : time
    if (beat !== this.beat) {
      this.beat = beat
      this.beatAt = time
    }
    const since = time - this.beatAt
    this.waterMat.uniforms.uTime.value = calm ? 0 : time

    // smoke puffs rise in 8 steps, grow, then pop
    const per = 3
    this.q.identity()
    for (let c = 0; c < this.chimneys.length; c++) {
      const top = this.chimneys[c]
      for (let i = 0; i < per; i++) {
        const ph = (t * 0.32 + i / per + c * 0.37) % 1
        const st = Math.floor(ph * 8) / 8
        const s = (st < 0.75 ? 0.14 + st * 0.22 : 0.3 * (1 - (st - 0.75) * 3)) * (calm ? 0 : 1)
        this.v.set(top.x + Math.sin(st * 5 + c) * 0.12 + st * 0.35, top.y + st * 1.1, top.z)
        this.m4.compose(this.v, this.q, this.s.set(s, s, s))
        this.smoke.setMatrixAt(c * per + i, this.m4)
        this.smoke.setColorAt(c * per + i, lin(st < 0.5 ? P.white : P.steel))
      }
    }
    this.smoke.instanceMatrix.needsUpdate = true
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true

    // fountain spray (10 fps)
    const f = this.fountainTop
    for (let i = 0; i < 10; i++) {
      const ph = Math.floor(((t * 0.9 + i / 10) % 1) * 10) / 10
      const a = (i / 10) * Math.PI * 2
      const r = 0.15 + ph * 0.75
      const y = f.y + 0.2 + 4 * ph * (1 - ph) * 0.55 - ph * 0.25
      this.v.set(f.x + Math.cos(a) * r, y, f.z + Math.sin(a) * r * 0.9)
      const s = calm ? 0 : 1
      this.m4.compose(this.v, this.q, this.s.set(s, s, s))
      this.drops.setMatrixAt(i, this.m4)
    }
    this.drops.instanceMatrix.needsUpdate = true

    // butterflies: 8 fps wing flaps on a lazy figure-eight
    for (const fl of this.flies) {
      const tt = t * 0.45 + fl.seed
      const flap = Math.floor(t * 8 + fl.seed * 3) % 2 === 0
      const x = fl.home.x + Math.sin(tt) * 0.9
      const z = fl.home.z + Math.sin(tt * 2) * 0.35
      const y = fl.home.y + Math.abs(Math.sin(tt * 3.1)) * 0.25 + (flap ? 0.03 : 0)
      for (const m of [fl.a, fl.b]) {
        m.position.set(x, y, z)
        m.quaternion.copy(camera.quaternion)
      }
      fl.a.visible = flap || calm
      fl.b.visible = !flap && !calm
    }

    // glass glints: pop on 3 frames at a time, for a few seconds after each beat change
    for (const g of this.glints) {
      const ph = (t * 0.6 + g.seed) % 1.6
      const on = !calm && since < GLINT_T && ph < 0.3
      g.m.visible = on
      if (on) {
        const s = ph < 0.1 ? 0.6 : ph < 0.2 ? 1 : 0.6
        g.m.scale.setScalar(s)
        g.m.quaternion.copy(camera.quaternion)
      }
    }
    // hens: trot a few steps (6 fps), stop, peck (4 fps), turn round
    for (const h of this.hens) {
      const cyc = (t * 0.22 + h.seed) % 2
      const leg = Math.floor(cyc) // 0 = out, 1 = back
      const ph = cyc % 1
      const moving = ph < 0.45
      const along = moving ? Math.floor((ph / 0.45) * 6) / 6 : 1
      const x = leg === 0 ? -h.span / 2 + along * h.span : h.span / 2 - along * h.span
      h.m.position.set(h.home.x + x, h.home.y + (moving && Math.floor(t * 6) % 2 ? 0.03 : 0), h.home.z + Math.sin(h.seed) * 0.2)
      h.m.rotation.y = leg === 0 ? 0 : Math.PI
      h.m.rotation.z = !calm && !moving && Math.floor(t * 4 + h.seed) % 3 === 0 ? -0.45 : 0
    }
    // antenna + terminal lights: blink at 1 Hz for a few seconds after each beat change, then rest lit
    const awake = !calm && since < BLINK_T
    for (let i = 0; i < this.blink.length; i++) this.blink[i].visible = !awake || Math.floor(since * 2 + i * 0.5) % 2 === 0
  }
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
