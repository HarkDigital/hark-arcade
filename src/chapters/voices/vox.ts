import * as THREE from 'three'
import { P } from '../../kit/pixel'

/*
 * Chapter-local voxel builder for the Side Quests village.
 *
 * The kit's voxels() merges one mesh per colour and lights it with toon
 * steps; for a JRPG village we want palette-EXACT pixel art instead: every
 * face gets a hand-picked Hark-16 colour by the way it faces (tops catch the
 * sun, walls turned from it take a hue-shifted shade), baked into vertex
 * colours and drawn unlit. Only exposed faces are emitted (optionally only
 * those the fixed camera can see, greedy-merged into rectangles), and whole
 * scenes merge into a single draw call.
 */

/** lighter palette neighbour: what a sunlit top face shows */
export const HI: Record<string, string> = {
  [P.void]: P.night,
  [P.night]: P.indigo,
  [P.indigo]: P.purple,
  [P.purple]: P.magenta,
  [P.magenta]: P.coral,
  [P.coral]: P.orange,
  [P.orange]: P.gold,
  [P.gold]: P.cream,
  [P.cream]: P.white,
  [P.white]: P.white,
  [P.steel]: P.cream,
  [P.slate]: P.steel,
  [P.signal]: P.signal,
  [P.green]: P.green,
  [P.pine]: P.green,
  [P.cyan]: P.white,
  [P.blue]: P.cyan,
  [P.brown]: P.orange,
}

/** darker, hue-shifted palette neighbour: faces turned from the light */
export const SH: Record<string, string> = {
  [P.void]: P.void,
  [P.night]: P.void,
  [P.indigo]: P.night,
  [P.purple]: P.indigo,
  [P.magenta]: P.purple,
  [P.coral]: P.magenta,
  [P.orange]: P.brown,
  [P.gold]: P.orange,
  [P.cream]: P.steel,
  [P.white]: P.steel,
  [P.steel]: P.slate,
  [P.slate]: P.night,
  [P.signal]: P.green,
  [P.green]: P.pine,
  [P.pine]: P.night,
  [P.cyan]: P.blue,
  [P.blue]: P.indigo,
  [P.brown]: P.night,
}

/**
 * How faces are coloured:
 *  - 'world': by WORLD direction after the transform. top = HI, south (toward
 *    the camera) = base, east/west = SH, north/bottom = SH.
 *  - 'figure': by MODEL direction (sprites don't relight when they turn).
 *    top/front/back = base, sides = SH.
 *  - 'soft': like 'world' but tops keep the base colour (foliage).
 *  - 'roof': tops keep the base colour, every wall-like face takes the shade
 *    (stepped roofs read as shingle rows).
 *  - 'flat': every face the base colour.
 */
export type Ramp = 'world' | 'soft' | 'roof' | 'figure' | 'flat'

const linCache = new Map<string, THREE.Color>()
export function lin(hex: string) {
  let c = linCache.get(hex)
  if (!c) linCache.set(hex, (c = new THREE.Color(hex)))
  return c
}

/** Growable buffers several models are emitted into, then turned into one geometry. */
export class Buf {
  pos: number[] = []
  col: number[] = []
  idx: number[] = []
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: string) {
    const k = lin(color)
    const n = this.pos.length / 3
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z)
    for (let i = 0; i < 4; i++) this.col.push(k.r, k.g, k.b)
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3)
  }
  /** convex polygon p[0..n) (CCW from outside) as a fan from vertex `from` */
  fan(p: THREE.Vector3[], n: number, from: number, color: string) {
    const k = lin(color)
    const b = this.pos.length / 3
    for (let i = 0; i < n; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z)
      this.col.push(k.r, k.g, k.b)
    }
    for (let j = 1; j < n - 1; j++) this.idx.push(b + from, b + ((from + j) % n), b + ((from + j + 1) % n))
  }
  /** convex polygon p[0..n) as a fan round its centre p[n] (every rim edge kept whole) */
  hub(p: THREE.Vector3[], n: number, color: string) {
    const k = lin(color)
    const b = this.pos.length / 3
    for (let i = 0; i <= n; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z)
      this.col.push(k.r, k.g, k.b)
    }
    for (let i = 0; i < n; i++) this.idx.push(b + n, b + i, b + ((i + 1) % n))
  }
  /** axis-aligned flat quad facing +y at height y */
  top(x0: number, z0: number, x1: number, z1: number, y: number, color: string) {
    _a.set(x0, y, z0)
    _b.set(x0, y, z1)
    _c.set(x1, y, z1)
    _d.set(x1, y, z0)
    this.quad(_a, _b, _c, _d, color)
  }
  /** vertical quad facing +z (south) spanning x0..x1, y0..y1 at z */
  south(x0: number, x1: number, y0: number, y1: number, z: number, color: string) {
    _a.set(x0, y0, z)
    _b.set(x1, y0, z)
    _c.set(x1, y1, z)
    _d.set(x0, y1, z)
    this.quad(_a, _b, _c, _d, color)
  }
  get empty() {
    return this.pos.length === 0
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    const n = this.pos.length / 3
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    return g
  }
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _n = new THREE.Vector3()
const _m3 = new THREE.Matrix3()

// cube faces: [dx, dy, dz, corners (unit cube, CCW from outside)], in the
// order +x, -x, +y, -y, +z, -z (face f lies on axis f >> 1)
const FACES: [number, number, number, number[][]][] = [
  [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [-1, 0, 0, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [0, 1, 0, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [0, 0, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
]

const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)

/** a face direction in WORLD space (after the model's transform) */
export type FaceDir = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
const DIRS: FaceDir[] = ['+x', '-x', '+y', '-y', '+z', '-z']
/**
 * Faces the village camera can never see. It is fixed for the whole level:
 * it looks north and down (direction ≈ (0, -0.74, -0.67), ±11° of FOV), so
 * every ray has y < -0.6 and z < -0.5 and no face turned down or north is
 * ever front-facing. Only for world-fixed props; figures turn round.
 */
export const TOP_DOWN: readonly FaceDir[] = ['-y', '-z']

export interface EmitOpts {
  ramp?: Ramp
  origin?: [number, number, number]
  m?: THREE.Matrix4
  /** leave out faces whose world-space normal points this way */
  skip?: readonly FaceDir[]
  /**
   * Greedy-merge coplanar same-colour faces into rectangles. Each rectangle
   * keeps every neighbouring corner that lands on its edges (no T-junctions),
   * so the mesh stays exactly as watertight as the per-voxel one.
   */
  merge?: boolean
}

/** base / lit / shaded colour per face direction */
const enum Tone {
  Base = 0,
  Hi = 1,
  Shade = 2,
}
const tone = (c: string, t: Tone) => (t === Tone.Hi ? (HI[c] ?? c) : t === Tone.Shade ? (SH[c] ?? c) : c)

// merge scratch (reused across emits)
let grid = new Int32Array(1024)
const pts: THREE.Vector3[] = []
const ptAt = (i: number) => (pts[i] ??= new THREE.Vector3())
const L = [0, 0, 0]
const P0 = [0, 0, 0]
const AT = [0, 0, 0, 0]
const SPLIT = [false, false, false, false]
const CN: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]

/** A sparse voxel grid in integer cells. */
export class Vox {
  cells = new Map<number, string>()
  private xs = new Map<number, [number, number, number]>()

  set(x: number, y: number, z: number, c: string | null | undefined) {
    const k = key(x, y, z)
    if (!c) {
      this.cells.delete(k)
      this.xs.delete(k)
      return
    }
    this.cells.set(k, c)
    this.xs.set(k, [x, y, z])
  }
  get(x: number, y: number, z: number) {
    return this.cells.get(key(x, y, z))
  }
  /** fill an inclusive box */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string | null) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c)
  }
  /** recolour existing cells in an inclusive box */
  paint(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (this.get(x, y, z)) this.set(x, y, z, c)
  }

  /**
   * Emit the exposed faces into `buf`. Cell (x,y,z) spans
   * [x,x+1]*size - origin; `m` (rotation/translation/scale) places the model.
   */
  emit(buf: Buf, size: number, o: EmitOpts = {}) {
    const ramp = o.ramp ?? 'world'
    const [ox, oy, oz] = o.origin ?? [0, 0, 0]
    const m = o.m
    if (m) _m3.setFromMatrix4(m)

    // per face direction: its colour tone, and whether it is skipped
    const tones: Tone[] = []
    const off: boolean[] = []
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACES[f]
      _n.set(dx, dy, dz)
      if (m) _n.applyMatrix3(_m3).normalize()
      const ax = Math.abs(_n.x)
      const ay = Math.abs(_n.y)
      const az = Math.abs(_n.z)
      const dir: FaceDir = ax >= ay && ax >= az ? (_n.x > 0 ? '+x' : '-x') : ay >= az ? (_n.y > 0 ? '+y' : '-y') : _n.z > 0 ? '+z' : '-z'
      off.push(!!o.skip && o.skip.includes(dir))
      if (m && ramp === 'figure') _n.set(dx, dy, dz)
      let t = Tone.Base
      if (ramp !== 'flat') {
        if (_n.y > 0.5) t = ramp === 'world' ? Tone.Hi : Tone.Base
        else if (_n.y < -0.5) t = Tone.Shade
        else if (ramp === 'roof') t = Tone.Shade
        else if (ramp === 'world' || ramp === 'soft') t = _n.z > 0.5 ? Tone.Base : Tone.Shade
        else t = Math.abs(_n.x) > 0.5 ? Tone.Shade : Tone.Base
      }
      tones.push(t)
    }

    const place = (i: number, x: number, y: number, z: number) => {
      const v = ptAt(i).set(x * size - ox, y * size - oy, z * size - oz)
      if (m) v.applyMatrix4(m)
      return v
    }

    if (!o.merge) {
      for (const [k, c] of this.cells) {
        const [x, y, z] = this.xs.get(k)!
        for (let f = 0; f < 6; f++) {
          if (off[f]) continue
          const [dx, dy, dz, corners] = FACES[f]
          if (this.cells.has(key(x + dx, y + dy, z + dz))) continue
          for (let i = 0; i < 4; i++) {
            const q = corners[i]
            place(i, x + q[0], y + q[1], z + q[2])
          }
          buf.quad(pts[0], pts[1], pts[2], pts[3], tone(c, tones[f]))
        }
      }
      return
    }

    // ---- 1. exposed faces, bucketed by plane (direction + depth)
    const colorIds = new Map<string, number>()
    const colors: string[] = []
    const planes = new Map<number, number[]>()
    for (const [k, c] of this.cells) {
      const cell = this.xs.get(k)!
      for (let f = 0; f < 6; f++) {
        if (off[f]) continue
        const [dx, dy, dz] = FACES[f]
        if (this.cells.has(key(cell[0] + dx, cell[1] + dy, cell[2] + dz))) continue
        const col = tone(c, tones[f])
        let id = colorIds.get(col)
        if (id === undefined) {
          id = colors.length
          colors.push(col)
          colorIds.set(col, id)
        }
        const a = f >> 1
        const pk = f * 8192 + cell[a] + 4096
        let list = planes.get(pk)
        if (!list) planes.set(pk, (list = []))
        list.push(cell[(a + 1) % 3], cell[(a + 2) % 3], id)
      }
    }

    // ---- 2. greedy rectangles per plane: [f, w, u0, v0, u1, v1, colour]
    const rects: number[] = []
    for (const [pk, list] of planes) {
      const f = Math.floor(pk / 8192)
      const w = pk - f * 8192 - 4096
      let u0 = Infinity
      let v0 = Infinity
      let u1 = -Infinity
      let v1 = -Infinity
      for (let i = 0; i < list.length; i += 3) {
        u0 = Math.min(u0, list[i])
        u1 = Math.max(u1, list[i])
        v0 = Math.min(v0, list[i + 1])
        v1 = Math.max(v1, list[i + 1])
      }
      const W = u1 - u0 + 1
      const H = v1 - v0 + 1
      if (grid.length < W * H) grid = new Int32Array(Math.max(W * H, grid.length * 2))
      grid.fill(0, 0, W * H)
      for (let i = 0; i < list.length; i += 3) grid[(list[i + 1] - v0) * W + (list[i] - u0)] = list[i + 2] + 1
      for (let v = 0; v < H; v++)
        for (let u = 0; u < W; u++) {
          const c = grid[v * W + u]
          if (!c) continue
          let ue = u
          while (ue + 1 < W && grid[v * W + ue + 1] === c) ue++
          let ve = v
          grow: while (ve + 1 < H) {
            const row = (ve + 1) * W
            for (let j = u; j <= ue; j++) if (grid[row + j] !== c) break grow
            ve++
          }
          for (let vv = v; vv <= ve; vv++) grid.fill(0, vv * W + u, vv * W + ue + 1)
          rects.push(f, w, u + u0, v + v0, ue + u0, ve + v0, c - 1)
        }
    }

    // ---- 3. every rectangle corner (lattice points), for T-junction repair
    const cornerKeys = new Set<number>()
    const cornerOf = (r: number, q: number[], out: number[]) => {
      const f = rects[r]
      const a = f >> 1
      const ua = (a + 1) % 3
      const va = (a + 2) % 3
      out[a] = rects[r + 1] + q[a]
      out[ua] = q[ua] ? rects[r + 4] + 1 : rects[r + 2]
      out[va] = q[va] ? rects[r + 5] + 1 : rects[r + 3]
      return out
    }
    for (let r = 0; r < rects.length; r += 7) {
      const corners = FACES[rects[r]][3]
      for (let i = 0; i < 4; i++) {
        cornerOf(r, corners[i], L)
        cornerKeys.add(key(L[0], L[1], L[2]))
      }
    }

    // ---- 4. each rectangle as a polygon through its corners + any T-points
    for (let r = 0; r < rects.length; r += 7) {
      const corners = FACES[rects[r]][3]
      for (let i = 0; i < 4; i++) cornerOf(r, corners[i], CN[i])
      let n = 0
      for (let i = 0; i < 4; i++) {
        const A = CN[i]
        const B = CN[(i + 1) % 4]
        AT[i] = n
        place(n++, A[0], A[1], A[2])
        const e = A[0] !== B[0] ? 0 : A[1] !== B[1] ? 1 : 2
        const step = B[e] > A[e] ? 1 : -1
        SPLIT[i] = false
        P0[0] = A[0]
        P0[1] = A[1]
        P0[2] = A[2]
        for (let t = A[e] + step; t !== B[e]; t += step) {
          P0[e] = t
          if (!cornerKeys.has(key(P0[0], P0[1], P0[2]))) continue
          place(n++, P0[0], P0[1], P0[2])
          SPLIT[i] = true
        }
      }
      const col = colors[rects[r + 6]]
      if (n === 4) {
        buf.quad(pts[0], pts[1], pts[2], pts[3], col)
        continue
      }
      // fan from a corner whose two edges are whole, else round the centre
      let from = -1
      for (let i = 0; i < 4 && from < 0; i++) if (!SPLIT[i] && !SPLIT[(i + 3) % 4]) from = AT[i]
      if (from >= 0) buf.fan(pts, n, from, col)
      else {
        const c = CN[0]
        const d = CN[2]
        place(n, (c[0] + d[0]) / 2, (c[1] + d[1]) / 2, (c[2] + d[2]) / 2)
        buf.hub(pts, n, col)
      }
    }
  }

  /** stand-alone geometry for this model */
  geometry(size: number, o: EmitOpts = {}) {
    const b = new Buf()
    this.emit(b, size, o)
    return b.geometry()
  }
}

/** The one material every voxel mesh in the village shares (unlit vertex colours). */
let shared: THREE.MeshBasicMaterial | null = null
export function voxMaterial() {
  return (shared ??= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
}

/** Place-and-rotate helper: translate to (x,y,z), rotate by quarter turns about y. */
export function place(x: number, y: number, z: number, quarter = 0, scale = 1) {
  const m = new THREE.Matrix4().makeRotationY((quarter * Math.PI) / 2)
  if (scale !== 1) m.multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
  m.setPosition(x, y, z)
  return m
}
