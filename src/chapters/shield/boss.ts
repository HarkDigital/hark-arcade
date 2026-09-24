import * as THREE from 'three'
import { P, voxels } from '../../kit/pixel'
import { fract, hash1, stepq } from './timeline'

/*
 * MALWARE.EXE — a big glitchy voxel virus-bug: a magenta shell crowned with
 * coral-tipped virus spikes, angry eyes, a fanged grin, a pulsing core in its
 * forehead (the weak point) and six skittering legs planted on the arena
 * floor. Its own toon materials carry a band-glitch vertex offset (VHS
 * tearing on the model itself) and an emissive hit flash.
 */

const S = 0.1
const RX = 13.5
const RY = 10.5
const RZ = 8.5
/** body centre above the floor */
export const BODY_Y = 2.65
const SPIKES = [16, 46, 76, 104, 134, 164].map(d => (d * Math.PI) / 180)
const SPOTS: [number, number, number][] = [
  [-9.5, 5, 2],
  [9.5, 5.5, 1.5],
  [0, 10, -3],
  [-12, -1, -2],
  [12, -1.5, -2],
  [-5, 8, -6],
  [6, 6, -7],
  [-2, 1, -9],
]

const insideBody = (x: number, y: number, z: number) => (x / RX) ** 2 + (y / RY) ** 2 + (z / RZ) ** 2 <= 1
function frontZ(x: number, y: number) {
  const k = 1 - (x / RX) ** 2 - (y / RY) ** 2
  return k <= 0 ? -99 : Math.floor(RZ * Math.sqrt(k))
}

function spikeAt(x: number, y: number, z: number): string | null {
  if (Math.abs(z) > 1.5) return null
  for (const a of SPIKES) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    const bx = RX * 0.9 * c
    const by = RY * 0.9 * s
    let nx = c / RX
    let ny = s / RY
    const nl = Math.hypot(nx, ny)
    nx /= nl
    ny /= nl
    const kx = bx + nx * 5.2
    const ky = by + ny * 5.2
    const kd = (x - kx) ** 2 + (y - ky) ** 2 + z * z
    if (kd <= 0.9) return 'g'
    if (kd <= 2.1 ** 2) return 'c'
    const t = (x - bx) * nx + (y - by) * ny
    if (t >= 0 && t <= 4.4 && Math.abs(z) <= 0.6) {
      const px = bx + nx * t
      const py = by + ny * t
      if ((x - px) ** 2 + (y - py) ** 2 <= 0.75 ** 2) return 'm'
    }
  }
  return null
}

function faceAt(x: number, y: number): string | null {
  // the core's socket (the core itself is a glowing mesh)
  if (x * x + (y - 6.4) ** 2 <= 2.7 ** 2) return 'v'
  for (const s of [-1, 1]) {
    const dx = x - 5 * s
    const dy = y - 1.4
    const t = -s * dx
    const yb = 1.4 + 2.3 - 0.55 * t
    if (Math.abs(dx) <= 4.2 && y >= yb - 0.3 && y <= yb + 1.1) return 'v'
    if ((dx / 3.4) ** 2 + (dy / 2.8) ** 2 <= 1 && y < yb - 0.3) return 'w'
  }
  const my = -4.4
  if ((x / 7.3) ** 2 + ((y - my) / 2.0) ** 2 <= 1) {
    for (const fx of [-4.5, -1.5, 1.5, 4.5]) if (Math.abs(x - fx) < 0.6 && y >= my + 0.9) return 'e'
    for (const fx of [-3, 0, 3]) if (Math.abs(x - fx) < 0.6 && y <= my - 0.9) return 'e'
    return 'v'
  }
  return null
}

function colorAt(x: number, y: number, z: number): string {
  const sp = spikeAt(x, y, z)
  if (sp && !insideBody(x, y, z)) return sp
  const fz = frontZ(x, y)
  if (z >= fz - 1 && z > 2 && Math.abs(x) < 11) {
    const f = faceAt(x, y)
    if (f) return f
  }
  if (y <= -7.5) return (x + z) % 5 === 0 ? 'v' : 'p'
  if (y <= -6.5 && y > -7.5) return 'v'
  for (const [sx, sy, sz] of SPOTS) if ((x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2 <= 2.4 ** 2) return 'c'
  return 'm'
}

function bodyLayers(): string[][] {
  const X0 = -20
  const X1 = 20
  const Y0 = -11
  const Y1 = 16
  const Z0 = -9
  const Z1 = 9
  const cache = new Map<string, boolean>()
  const solid = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`
    let v = cache.get(k)
    if (v === undefined) {
      v = insideBody(x, y, z) || spikeAt(x, y, z) !== null
      cache.set(k, v)
    }
    return v
  }
  const layers: string[][] = []
  for (let z = Z1; z >= Z0; z--) {
    const rows: string[] = []
    for (let y = Y1; y >= Y0; y--) {
      let row = ''
      for (let x = X0; x <= X1; x++) {
        let ch = '.'
        if (solid(x, y, z)) {
          const hidden =
            solid(x + 1, y, z) && solid(x - 1, y, z) && solid(x, y + 1, z) && solid(x, y - 1, z) && solid(x, y, z + 1) && solid(x, y, z - 1)
          if (!hidden) ch = colorAt(x, y, z)
        }
        row += ch
      }
      rows.push(row)
    }
    layers.push(rows)
  }
  return layers
}

/* ------------------------------------------------------------ materials */

let ramp: THREE.DataTexture | null = null
function toonRamp() {
  if (ramp) return ramp
  const data = new Uint8Array([90, 170, 255].flatMap(v => [v, v, v, 255]))
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  return ramp
}

/** shared glitch uniforms for every boss material */
export const bossGlitch = { amount: { value: 0 }, seed: { value: 0 } }

function bossMat(color: string, glitch = true) {
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: toonRamp() })
  m.emissive.set('#ffffff')
  m.emissiveIntensity = 0
  if (glitch) {
    m.onBeforeCompile = shader => {
      shader.uniforms.uGlitch = bossGlitch.amount
      shader.uniforms.uSeed = bossGlitch.seed
      shader.vertexShader =
        'uniform float uGlitch;\nuniform float uSeed;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float gBand = floor(position.y * 3.0 + 64.0);
          float gR = fract(sin(gBand * 12.9898 + uSeed * 78.233) * 43758.5453);
          transformed.x += uGlitch * (gR - 0.5) * 1.1 * step(0.58, gR);`,
        )
    }
    m.customProgramCacheKey = () => 'hark-arcade-boss-glitch'
  }
  return m
}

/* ------------------------------------------------------------ legs */

interface Leg {
  side: number
  hip: THREE.Vector3
  foot: THREE.Vector3
  group: number
}

const L1 = 1.4
const L2 = 2.05
const UP = new THREE.Vector3(0, 1, 0)

export interface BossState {
  time: number
  /** 0..1 how much it's animating (reduced motion calms it) */
  pace: number
  /** vertical offset (the drop-in) */
  drop: number
  /** 0..1 hit flash on the materials */
  hit: number
  /** 0..1 glitch tearing */
  glitch: number
  /** recoil: pushes the body back/up */
  recoil: number
  /** pupil target (world), e.g. the site */
  look: THREE.Vector3
  /** 0..1 death shake (before it bursts) */
  dying: number
  /** core pulse 0..1 */
  core: number
  visible: boolean
}

export class Boss {
  group = new THREE.Group()
  body = new THREE.Group()
  core: THREE.Mesh
  coreIn: THREE.Mesh
  private coreMat: THREE.MeshBasicMaterial
  private coreInMat: THREE.MeshBasicMaterial
  pupils: THREE.Group[] = []
  private eyeRest: THREE.Vector3[] = []
  private legs: THREE.InstancedMesh
  private nodes: THREE.InstancedMesh
  private legList: Leg[] = []
  mats: THREE.MeshToonMaterial[] = []
  shadow: THREE.Mesh
  /** feet positions (group space), updated each frame */
  feet: THREE.Vector3[] = []
  /** sample points on the body (body space), for debris and pops */
  samples: { p: THREE.Vector3; c: string }[] = []
  /** body-space mouth and core */
  readonly mouth = new THREE.Vector3(0, -0.44, 0.75)
  readonly coreLocal = new THREE.Vector3(0, 0.64, 0.66)

  private _m = new THREE.Matrix4()
  private _q = new THREE.Quaternion()
  private _s = new THREE.Vector3()
  private _p = new THREE.Vector3()
  private _a = new THREE.Vector3()
  private _b = new THREE.Vector3()
  private _k = new THREE.Vector3()
  private _d = new THREE.Vector3()
  private _pole = new THREE.Vector3()
  private _col = new THREE.Color()
  private _mid = new THREE.Vector3()
  private _sc = new THREE.Vector3()

  constructor() {
    const matCache = new Map<string, THREE.MeshToonMaterial>()
    const factory = (c: string) => {
      let m = matCache.get(c)
      if (!m) {
        m = bossMat(c)
        matCache.set(c, m)
        this.mats.push(m)
      }
      return m
    }
    const layers = bodyLayers()
    const map = { m: P.magenta, c: P.coral, p: P.purple, v: P.void, w: P.white, e: P.cream, g: P.gold }
    const mesh = voxels(layers, map, { size: S, material: factory })
    // voxels() centres the grid (y -11..16 → mid 2.5); put the ellipsoid centre at the origin
    mesh.position.y = 0.25
    this.body.add(mesh)

    // sample body points for debris colours / positions
    for (let zi = 0; zi < layers.length; zi += 2) {
      const z = 9 - zi
      layers[zi].forEach((row, yi) => {
        const y = 16 - yi
        for (let xi = 0; xi < row.length; xi += 2) {
          const ch = row[xi]
          if (ch === '.') continue
          this.samples.push({ p: new THREE.Vector3((xi - 20) * S, y * S, z * S), c: map[ch as keyof typeof map] })
        }
      })
    }

    // pupils (they track the site)
    for (const s of [-1, 1]) {
      const pg = voxels(['vv', 'vv'], { v: P.void }, { size: S * 1.1, depth: 1, material: factory })
      const z = frontZ(5, 1.4) * S + 0.1
      const rest = new THREE.Vector3(0.5 * s, 0.12, z)
      pg.position.copy(rest)
      this.pupils.push(pg)
      this.eyeRest.push(rest)
      this.body.add(pg)
    }

    // the core: a pulsing orb in the forehead socket
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.coral).multiplyScalar(1.6), toneMapped: false })
    this.coreInMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.gold).multiplyScalar(1.9), toneMapped: false })
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.coreMat)
    this.core.position.copy(this.coreLocal)
    this.coreIn = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), this.coreInMat)
    this.coreIn.position.set(0, 0.02, 0.13)
    this.core.add(this.coreIn)
    this.body.add(this.core)

    // legs: two segments each + knee / claw nodes
    const legMat = bossMat(P.magenta, false)
    const nodeMat = bossMat('#ffffff', false)
    this.mats.push(legMat, nodeMat)
    const segGeo = new THREE.BoxGeometry(0.26, 1, 0.26)
    this.legs = new THREE.InstancedMesh(segGeo, legMat, 12)
    this.nodes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), nodeMat, 12)
    for (let i = 0; i < 12; i++) this.nodes.setColorAt(i, this._col.set(i < 6 ? P.coral : P.gold))
    this.legs.frustumCulled = false
    this.nodes.frustumCulled = false
    const defs: [number, number, number, number, number, number][] = [
      // side, hipX, hipZ, footX, footZ, gait group
      [-1, -1.0, 0.5, -2.3, 1.1, 0],
      [-1, -1.15, 0.0, -2.8, 0.15, 1],
      [-1, -1.0, -0.5, -2.45, -0.9, 0],
      [1, 1.0, 0.5, 2.3, 1.1, 1],
      [1, 1.15, 0.0, 2.8, 0.15, 0],
      [1, 1.0, -0.5, 2.45, -0.9, 1],
    ]
    for (const [side, hx, hz, fx, fz, g] of defs) {
      this.legList.push({ side, hip: new THREE.Vector3(hx, -0.35, hz), foot: new THREE.Vector3(fx, 0, fz), group: g })
      this.feet.push(new THREE.Vector3(fx, 0, fz))
    }

    // a soft dark footprint on the floor
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ color: P.void, transparent: true, opacity: 0.45, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.scale.set(2.9, 1.35, 1)
    this.shadow.position.y = 0.075

    this.group.add(this.body, this.legs, this.nodes, this.shadow)
  }

  /** world position of the mouth / core (after update) */
  mouthWorld(out: THREE.Vector3) {
    return this.body.localToWorld(out.copy(this.mouth))
  }
  coreWorld(out: THREE.Vector3) {
    return this.body.localToWorld(out.copy(this.coreLocal))
  }

  update(st: BossState) {
    const t = st.time
    const pace = st.pace
    this.body.visible = st.visible
    this.legs.visible = st.visible
    this.nodes.visible = st.visible
    this.shadow.visible = st.visible

    // gait: two tripods, stepped at 10 fps
    const tq = stepq(t, 10) * pace
    const bob = pace > 0 ? (Math.sin(tq * Math.PI * 2 * 1.3) > 0 ? 0.06 : 0) : 0
    const shake = st.dying > 0 ? (hash1(Math.floor(t * 20)) - 0.5) * 0.16 * st.dying : 0
    this.body.position.set(shake, BODY_Y + st.drop + bob + st.recoil * 0.12, -st.recoil * 0.25)
    this.body.rotation.z = shake * 0.4
    this.body.updateMatrixWorld(true)

    // legs (2-bone IK in group space)
    const bodyP = this.body.position
    for (let i = 0; i < this.legList.length; i++) {
      const L = this.legList[i]
      const ph = fract(tq * 0.65 + L.group * 0.5)
      const lift = Math.max(0, Math.sin(ph * Math.PI * 2)) * 0.32
      const H = this._a.copy(L.hip).add(bodyP)
      const F = this._b.copy(L.foot)
      F.y = Math.max(0.05, F.y + lift + st.drop * 0.92)
      F.x += L.side * lift * 0.2
      const d = this._d.subVectors(F, H)
      let len = d.length()
      len = Math.min(len, L1 + L2 - 0.01)
      d.normalize()
      const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len)
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
      const pole = this._pole.set(L.side * 0.6, 1, 0).normalize()
      pole.addScaledVector(d, -pole.dot(d)).normalize()
      const K = this._k.copy(H).addScaledVector(d, a).addScaledVector(pole, h)
      const Fr = this._p.copy(H).addScaledVector(d, len)
      this.setSeg(i * 2, H, K)
      this.setSeg(i * 2 + 1, K, Fr)
      this._m.makeTranslation(K.x, K.y, K.z)
      this.nodes.setMatrixAt(i, this._m)
      this._m.makeTranslation(Fr.x, Fr.y, Fr.z)
      this.nodes.setMatrixAt(6 + i, this._m)
      this.feet[i].copy(Fr)
    }
    this.legs.instanceMatrix.needsUpdate = true
    this.nodes.instanceMatrix.needsUpdate = true

    // pupils track the target, squint when hit
    for (let i = 0; i < 2; i++) {
      const pg = this.pupils[i]
      const rest = this.eyeRest[i]
      const w = this.body.localToWorld(this._a.copy(rest))
      const dir = this._b.subVectors(st.look, w)
      dir.z = 0
      dir.normalize()
      pg.position.set(rest.x + Math.round(dir.x * 1.2) * 0.08, rest.y + Math.round(dir.y * 1.2) * 0.06, rest.z)
      pg.scale.set(1, st.hit > 0.3 || st.dying > 0 ? 0.35 : 1, 1)
    }

    // core pulse (stepped) + colour
    const beat = pace > 0 ? stepq(fract(t * 1.6), 4) : 0.5
    const k = 1 + 0.18 * (beat < 0.5 ? beat * 2 : 2 - beat * 2) + st.core * 0.35
    this.core.scale.setScalar(k)
    this.coreMat.color.set(st.hit > 0.2 ? P.white : P.coral).multiplyScalar(1.6 + st.core)
    this.coreInMat.color.set(P.gold).multiplyScalar(1.9 + st.core)

    // hit flash: bright, but capped so the bloom never blows out the arena
    const em = Math.min(0.62, st.hit * 0.62)
    for (const m of this.mats) m.emissiveIntensity = em
    bossGlitch.amount.value = st.glitch
    bossGlitch.seed.value = Math.floor(t * 12) % 97

    this.shadow.scale.set(2.9 * (1 - Math.min(0.6, st.drop * 0.15)), 1.35, 1)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * Math.max(0, 1 - st.drop * 0.25)
  }

  private setSeg(i: number, A: THREE.Vector3, B: THREE.Vector3) {
    const dir = this._s.subVectors(B, A)
    const len = dir.length()
    dir.divideScalar(Math.max(1e-4, len))
    this._q.setFromUnitVectors(UP, dir)
    const mid = this._mid.addVectors(A, B).multiplyScalar(0.5)
    this._m.compose(mid, this._q, this._sc.set(1, len, 1))
    this.legs.setMatrixAt(i, this._m)
  }
}
