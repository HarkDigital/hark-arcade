import * as THREE from 'three'
import { P, glow, voxels } from '../../kit/pixel'
import { logoGeometry } from '../../logo/logo'
import { hash1, pop, stepq } from './timeline'

/*
 * The player: a little voxel browser window (title bar with traffic-light
 * dots, a URL bar, the Hark mark glowing on its screen, text lines and a
 * button) standing on two stubby feet. Damage shows as glitch strips
 * crawling over the screen; the Hark shield is a honeycomb dome of hex
 * cells that pops out cell by cell.
 */

const V = 0.08
const COLS = 24
const ROWS = 16
/** frame bottom above the floor (the feet stand under it) */
const LIFT = 0.15
export const SITE_W = COLS * V
export const SITE_H = ROWS * V + LIFT
/** full height of the voxel model, feet included */
export const SITE_TOP = (ROWS + 2) * V

const C_SIGNAL = new THREE.Color(P.signal)

function siteLayers(): string[][] {
  const front: string[] = []
  const back: string[] = []
  for (let y = 0; y < ROWS + 2; y++) {
    let f = ''
    let b = ''
    for (let x = 0; x < COLS; x++) {
      let ch = '.'
      let screen = false
      if (y >= ROWS) {
        // feet
        const foot = (x >= 4 && x <= 6) || (x >= 17 && x <= 19)
        ch = foot ? (y === ROWS + 1 ? 'k' : 'd') : '.'
      } else if ((x === 0 || x === COLS - 1) && (y === 0 || y === ROWS - 1)) ch = '.'
      else if (y <= 2) {
        ch = 'c'
        if (y === 1 && x === 2) ch = 'r'
        if (y === 1 && x === 4) ch = 'y'
        if (y === 1 && x === 6) ch = 'g'
        if (y === 1 && x >= 9 && x <= 21) ch = 's'
      } else if (y === ROWS - 1 || x === 0 || x === COLS - 1) ch = 'c'
      else {
        screen = true
        ch = 'n'
        if (x >= 13 && x <= 20 && y === 5) ch = 'l'
        if (x >= 13 && x <= 18 && y === 7) ch = 'l'
        if (x >= 13 && x <= 19 && y === 9) ch = 'l'
        if (x >= 13 && x <= 17 && (y === 11 || y === 12)) ch = 'b'
      }
      f += screen ? '.' : ch
      b += ch
    }
    front.push(f)
    back.push(b)
  }
  return [front, back, back]
}

export interface SiteState {
  time: number
  pace: number
  /** 0..6 damage level: glitch strips over the screen */
  damage: number
  /** 0..1 fresh hit (jolt + squash) */
  jolt: number
  /** continuous small impacts while bullets land */
  jiggle: number
  /** victory hop height */
  hop: number
  /** 0..1 restored glow */
  healthy: number
}

export class Site {
  group = new THREE.Group()
  body = new THREE.Group()
  mark: THREE.Mesh
  private markMat: THREE.MeshBasicMaterial
  private strips: THREE.InstancedMesh
  private stripData: { x: number; y: number; w: number; g: number; c: THREE.Color }[] = []
  shadow: THREE.Mesh
  private _m = new THREE.Matrix4()
  private _q = new THREE.Quaternion()
  private _p = new THREE.Vector3()
  private _s = new THREE.Vector3()
  private glowK = NaN

  constructor() {
    const vox = voxels(
      siteLayers(),
      { c: P.cream, r: P.coral, y: P.gold, g: P.signal, s: P.slate, n: P.night, l: P.steel, b: P.signal, d: P.slate, k: P.void },
      { size: V },
    )
    // voxels() centres the model; sit its feet on the floor
    vox.position.y = ((ROWS + 2) * V) / 2
    this.body.add(vox)

    this.markMat = glow(P.signal, 1.25)
    this.mark = new THREE.Mesh(logoGeometry({ depth: 0.05 }), this.markMat)
    this.mark.scale.setScalar(V * 8.4)
    // screen-left, centred on the content rows
    this.mark.position.set((6.5 - (COLS - 1) / 2) * V, (ROWS + 2 - 8.6) * V, 0.05)
    this.body.add(this.mark)

    // glitch strips (6 damage groups, 5 strips each)
    const cols = [P.magenta, P.coral, P.purple, P.magenta, P.gold, P.void]
    for (let g = 0; g < 6; g++) {
      for (let j = 0; j < 5; j++) {
        const i = g * 5 + j
        const w = 2 + Math.floor(hash1(i * 3.1) * 6)
        const x = 1 + Math.floor(hash1(i * 7.7) * (COLS - 2 - w))
        const y = 3 + Math.floor(hash1(i * 5.3) * (ROWS - 4))
        this.stripData.push({ x, y, w, g, c: new THREE.Color(cols[(i + g) % cols.length]) })
      }
    }
    this.strips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      this.stripData.length,
    )
    this.strips.frustumCulled = false
    this.stripData.forEach((s, i) => this.strips.setColorAt(i, s.c))
    this.body.add(this.strips)

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: P.void, transparent: true, opacity: 0.4, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.scale.set(1.2, 0.45, 1)
    this.shadow.position.y = 0.072

    this.group.add(this.body, this.shadow)
  }

  update(st: SiteState) {
    const t = st.time
    // jolt: knocked back + squashed, then springs back
    const j = st.jolt
    const jig = st.pace > 0 ? (hash1(Math.floor(t * 24)) - 0.5) * 0.05 * st.jiggle : 0
    this.body.position.set(-j * 0.16 + jig, st.hop, 0)
    this.body.scale.set(1 + j * 0.1, 1 - j * 0.12 + st.hop * 0.15, 1)
    this.shadow.scale.set(1.2 * (1 - st.hop * 0.8), 0.45 * (1 - st.hop * 0.8), 1)

    // the mark flickers for a beat after each hit (finite: it dies with the jolt)
    const flick = st.damage > 0 && st.pace > 0 && j > 0.15 && hash1(Math.floor(t * 10) + 3.3) < 0.08 * st.damage
    this.mark.visible = !flick
    const glowK = 1.1 + 0.5 * st.healthy
    if (glowK !== this.glowK) {
      this.glowK = glowK
      this.markMat.color.copy(C_SIGNAL).multiplyScalar(glowK)
    }

    // glitch strips
    let n = 0
    for (let i = 0; i < this.stripData.length; i++) {
      const s = this.stripData[i]
      const on = st.damage > s.g
      const blink = st.pace > 0 ? hash1(Math.floor(t * 6) + i * 1.7) < 0.82 : true
      if (!on || !blink) continue
      const jx = st.pace > 0 ? Math.round((hash1(Math.floor(t * 8) + i * 9.1) - 0.5) * 4) : 0
      const cx = (s.x + jx + s.w / 2 - COLS / 2) * V
      const cy = (ROWS + 2 - s.y - 0.5) * V
      this._p.set(cx, cy, 0.1)
      this._s.set(s.w * V, V, 0.04)
      this._m.compose(this._p, this._q, this._s)
      this.strips.setMatrixAt(n, this._m)
      this.strips.setColorAt(n, s.c)
      n++
    }
    this.strips.count = n
    this.strips.instanceMatrix.needsUpdate = true
    if (this.strips.instanceColor) this.strips.instanceColor.needsUpdate = true
  }
}

/* ------------------------------------------------------------ the shield */

export const SHIELD_R = 1.85

export class Shield {
  group = new THREE.Group()
  private rings: THREE.InstancedMesh
  private fills: THREE.InstancedMesh
  private shock: THREE.Mesh
  private shockMat: THREE.MeshBasicMaterial
  cells: { x: number; y: number; d: number; rim: number }[] = []
  private _m = new THREE.Matrix4()
  private _q = new THREE.Quaternion()
  private _p = new THREE.Vector3()
  private _s = new THREE.Vector3()
  private _c = new THREE.Color()
  /** per-cell highlight from impacts (written by the fx each frame) */
  heat: Float32Array

  constructor() {
    const r = 0.25
    // flat-top hex layout
    for (let q = -10; q <= 10; q++) {
      for (let s = -10; s <= 10; s++) {
        const x = r * 1.5 * q
        const y = r * Math.sqrt(3) * (s + q / 2)
        const d = Math.hypot(x, y)
        if (y < -0.05 || d > SHIELD_R - r * 0.4) continue
        this.cells.push({ x, y, d: d / SHIELD_R, rim: 0 })
      }
    }
    for (const c of this.cells) c.rim = Math.max(0, (c.d - 0.72) / 0.28)
    this.heat = new Float32Array(this.cells.length)
    const ringGeo = new THREE.RingGeometry(r * 0.8, r * 0.97, 6, 1)
    const fillGeo = new THREE.CircleGeometry(r * 0.8, 6)
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), this.cells.length)
    this.fills = new THREE.InstancedMesh(
      fillGeo,
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.2, depthWrite: false }),
      this.cells.length,
    )
    this.rings.frustumCulled = this.fills.frustumCulled = false
    for (let i = 0; i < this.cells.length; i++) {
      this.rings.setColorAt(i, this._c.set('#ffffff'))
      this.fills.setColorAt(i, this._c.set('#ffffff'))
    }
    this.fills.renderOrder = 2
    this.rings.renderOrder = 3
    this.shockMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.signal).multiplyScalar(1.6), toneMapped: false, transparent: true })
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48, 1), this.shockMat)
    this.group.add(this.fills, this.rings, this.shock)
  }

  /**
   * `build` 0..1: cells pop out from the centre (and, run backwards, retract
   * rim-first); `shock` 0..1 the ring that blasts out as it blooms; `ping`
   * 0..1 a soft 24/7 watch ring (−1 = off).
   */
  update(build: number, shock: number, ping: number, time: number, pace: number) {
    const on = build > 0
    const shimmer = pace > 0 ? (time * 0.9) % 2.4 : -1
    let n = 0
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      const u = (build * 1.35 - c.d) / 0.28
      const sc = pop(Math.min(1, Math.max(0, u)))
      if (!on || sc <= 0.01) continue
      const sweep = shimmer >= 0 ? Math.max(0, 1 - Math.abs(c.x * 0.45 + 0.8 - shimmer) * 4) : 0
      const hot = Math.min(1.4, this.heat[i])
      const k = 0.32 + c.rim * 1.15 + stepq(sweep, 3) * 0.75 + hot * 1.3
      this._p.set(c.x, c.y, 0)
      this._s.setScalar(sc)
      this._m.compose(this._p, this._q, this._s)
      this.rings.setMatrixAt(n, this._m)
      this.fills.setMatrixAt(n, this._m)
      this.rings.setColorAt(n, this._c.copy(C_SIGNAL).multiplyScalar(k))
      this.fills.setColorAt(n, this._c.copy(C_SIGNAL).multiplyScalar(0.3 + c.rim * 0.25 + hot * 1.1))
      n++
    }
    this.rings.count = this.fills.count = n
    this.rings.instanceMatrix.needsUpdate = true
    this.fills.instanceMatrix.needsUpdate = true
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true
    if (this.fills.instanceColor) this.fills.instanceColor.needsUpdate = true

    let ring = -1
    let op = 0
    if (shock > 0 && shock < 1) {
      ring = 0.3 + shock * 3.4
      op = 1 - stepq(shock, 5)
    } else if (ping >= 0) {
      ring = 0.6 + ping * 2.6
      op = 0.75 * (1 - stepq(ping, 5))
    }
    this.shock.visible = ring > 0 && op > 0.01
    this.shock.scale.setScalar(Math.max(0.01, ring))
    this.shockMat.opacity = op
    this.group.visible = n > 0 || this.shock.visible
  }
}
