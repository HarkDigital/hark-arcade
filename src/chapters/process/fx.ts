import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { clamp, rng } from '../../core/math'
import { Builder, FACET, R } from './builder'
import { NODE_S, TOTAL, groundAt, pathAt } from './timeline'

/*
 * Game juice: the dotted path (walked dots light up), coins that pop when the
 * player passes, star bursts on CLEAR!, fireworks over the RESULTS screen and
 * drifting parallax clouds. Everything is instanced; positions are pure
 * functions of (local, time) except the short burst "events".
 */

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _c = new THREE.Color()
const _pt = { x: 0, z: 0, dx: 0, dz: 0 }
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
const TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, 0, 0))

/* ------------------------------------------------------------------ dotted path */

export class PathDots {
  mesh: THREE.InstancedMesh
  private s: number[] = []
  private lit = -1
  private cDim = new THREE.Color(P.cream)
  private cLit = new THREE.Color(P.gold)

  constructor() {
    const pos: { x: number; y: number; z: number; s: number }[] = []
    const GAP = 0.34
    for (let s = 0.2; s < TOTAL; s += GAP) {
      if (NODE_S.some(n => Math.abs(n - s) < 0.62)) continue
      pathAt(s, _pt)
      pos.push({ x: _pt.x, y: groundAt(_pt.x, _pt.z), z: _pt.z, s })
    }
    const geo = new THREE.BoxGeometry(0.13, 0.05, 0.13)
    geo.translate(0, 0.025, 0)
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), pos.length)
    pos.forEach((p, i) => {
      _m.makeTranslation(p.x, p.y + 0.005, p.z)
      this.mesh.setMatrixAt(i, _m)
      this.mesh.setColorAt(i, this.cDim)
      this.s.push(p.s)
    })
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.frustumCulled = false
  }

  /** dots up to distance d turn gold */
  update(d: number) {
    let n = 0
    while (n < this.s.length && this.s[n] <= d + 0.01) n++
    if (n === this.lit) return
    this.lit = n
    for (let i = 0; i < this.s.length; i++) this.mesh.setColorAt(i, i < n ? this.cLit : this.cDim)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

/* ------------------------------------------------------------------ coins */

export class Coins {
  mesh: THREE.InstancedMesh
  private s: number[] = []
  private base: THREE.Vector3[] = []

  constructor() {
    // three coins in the middle of every leg of the journey
    for (let i = 0; i < 4; i++) {
      const a = NODE_S[i]
      const b = NODE_S[i + 1]
      const len = b - a
      for (let k = 0; k < 3; k++) this.s.push(a + len * (0.34 + k * 0.14))
    }
    for (const s of this.s) {
      pathAt(s, _pt)
      this.base.push(new THREE.Vector3(_pt.x, groundAt(_pt.x, _pt.z) + 0.42, _pt.z))
    }
    const b = new Builder()
    // an octagonal coin face-on to the camera, built from two crossed slabs
    b.box(0, -0.17, 0, 0.22, 0.34, 0.06, R.coin)
    b.box(0, -0.12, 0, 0.34, 0.24, 0.06, R.coin)
    b.box(0, -0.1, 0.035, 0.06, 0.2, 0.01, [P.orange, P.orange, P.orange])
    const geo = b.geometry()
    this.mesh = new THREE.InstancedMesh(geo, FACET, this.s.length)
    this.mesh.frustumCulled = false
  }

  update(d: number, time: number, calm: boolean) {
    // 4-frame spin: full, 3/4, edge, 3/4 (scale.x), stepped at 8 fps
    const SPIN = [1, 0.62, 0.18, 0.62]
    for (let i = 0; i < this.s.length; i++) {
      const passed = d - this.s[i]
      if (passed > 0.9) {
        this.mesh.setMatrixAt(i, ZERO)
        continue
      }
      const f = calm ? 0 : (Math.floor(time * 8) + i) % 4
      const k = clamp(passed / 0.9)
      const hop = passed > 0 ? Math.sin(k * Math.PI * 0.5) * 0.9 : (calm ? 0 : (Math.floor(time * 2 + i) % 2) * 0.04)
      const sc = passed > 0 ? 1 - k * 0.6 : 1
      _p.copy(this.base[i])
      _p.y += hop
      _s.set(SPIN[passed > 0 ? Math.floor(k * 12) % 4 : f] * sc, sc, sc)
      _q.copy(TILT)
      _m.compose(_p, _q, _s)
      this.mesh.setMatrixAt(i, _m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

/* ------------------------------------------------------------------ bursts */

const STAR_COLORS = [P.gold, P.cream, P.signal, P.gold, P.coral, P.cyan]

/**
 * Particle bursts (CLEAR! stars, fireworks). Each burst is a time-stamped
 * event; particles fly out radially under gravity on 12 fps steps, then die.
 */
export class Bursts {
  mesh: THREE.InstancedMesh
  private per: number
  private slots: { t0: number; origin: THREE.Vector3; seed: number; up: number; speed: number }[] = []
  private dirs: THREE.Vector3[][] = []

  constructor(count: number, per: number, size: number, strength: number) {
    this.per = per
    // a plus-shaped pixel star
    const a = new THREE.BoxGeometry(size, size * 0.34, size * 0.34)
    const b = new THREE.BoxGeometry(size * 0.34, size, size * 0.34)
    const geo = mergeTwo(a, b)
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(strength) })
    this.mesh = new THREE.InstancedMesh(geo, mat, count * per)
    this.mesh.frustumCulled = false
    const rand = rng(77)
    for (let s = 0; s < count; s++) {
      this.slots.push({ t0: -99, origin: new THREE.Vector3(), seed: s, up: 1, speed: 1 })
      const dirs: THREE.Vector3[] = []
      for (let i = 0; i < per; i++) {
        const ang = (i / per) * Math.PI * 2 + rand() * 0.3
        const el = 0.35 + rand() * 0.9
        dirs.push(new THREE.Vector3(Math.cos(ang) * Math.cos(el * 0.6), Math.sin(el), Math.sin(ang) * Math.cos(el * 0.6)))
        this.mesh.setColorAt(s * per + i, _c.set(STAR_COLORS[(i + s) % STAR_COLORS.length]))
        this.mesh.setMatrixAt(s * per + i, ZERO)
      }
      this.dirs.push(dirs)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  fire(slot: number, origin: THREE.Vector3, time: number, speed = 1, up = 1) {
    const s = this.slots[slot]
    s.t0 = time
    s.origin.copy(origin)
    s.speed = speed
    s.up = up
  }

  clear(slot: number) {
    this.slots[slot].t0 = -99
  }

  update(time: number, life = 0.9) {
    let any = false
    this.slots.forEach((s, si) => {
      const age = Math.floor((time - s.t0) * 12) / 12
      const alive = age >= 0 && age < life
      for (let i = 0; i < this.per; i++) {
        const idx = si * this.per + i
        if (!alive) {
          this.mesh.setMatrixAt(idx, ZERO)
          continue
        }
        any = true
        const d = this.dirs[si][i]
        const k = age / life
        const v = 2.6 * s.speed
        _p.set(
          s.origin.x + d.x * v * age,
          s.origin.y + d.y * v * age * s.up - 3.2 * age * age,
          s.origin.z + d.z * v * age,
        )
        const sc = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
        _s.setScalar(Math.max(0.001, sc))
        _q.identity()
        _m.compose(_p, _q, _s)
        this.mesh.setMatrixAt(idx, _m)
      }
    })
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.visible = any
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const pos: number[] = []
  const idx: number[] = []
  for (const g of [a, b]) {
    const base = pos.length / 3
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i))
    const ix = g.getIndex()!
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i))
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setIndex(idx)
  return out
}

/* ------------------------------------------------------------------ clouds */

export class Clouds {
  group = new THREE.Group()
  private items: { m: THREE.Object3D; x0: number; z0: number; speed: number }[] = []

  constructor(mobile: boolean) {
    // puffy pixel clouds: a flat belly, rounded ends, bumps on top
    const puff = (b: Builder, len: number, bumps: [number, number, number][]) => {
      b.box(0, 0, 0, len, 0.2, 0.7, R.cloud, true, true)
      b.box(0, 0.05, 0, len + 0.3, 0.2, 0.46, R.cloud, true, true)
      for (const [x, w, h] of bumps) {
        b.box(x, 0.2, 0, w, h, Math.min(0.7, w * 0.8), R.cloud, true, true)
        b.box(x, 0.2 + h, 0, w * 0.6, 0.12, Math.min(0.5, w * 0.5), R.cloud, true, true)
      }
    }
    const shapes = [
      (b: Builder) => puff(b, 1.6, [[-0.35, 0.7, 0.24], [0.35, 0.56, 0.16]]),
      (b: Builder) => puff(b, 1.1, [[0.05, 0.6, 0.2]]),
      (b: Builder) => puff(b, 2.1, [[-0.6, 0.62, 0.2], [0.15, 0.8, 0.32], [0.8, 0.5, 0.14]]),
    ]
    const meshes = shapes.map(fn => {
      const b = new Builder()
      b.outlineWidth = 0.04
      fn(b)
      return b
    })
    const spots: [number, number, number, number][] = [
      [-14, 4.2, 10.5, 0],
      [-3, 3.6, 12.5, 1],
      [9, 4.4, 11, 2],
      [-9, 4.8, -8.5, 2],
      [4, 4.2, -10.5, 1],
      [15, 3.8, -7.5, 0],
      [20, 4.6, 9.5, 1],
    ]
    const use = mobile ? spots.filter((_, i) => i % 2 === 0) : spots
    for (const [x, y, z, k] of use) {
      const m = meshes[k].mesh()
      m.position.set(x, y, z)
      this.group.add(m)
      this.items.push({ m, x0: x, z0: z, speed: 0.14 + (k % 2) * 0.06 })
    }
  }

  /** spread > 1 parts the clouds outward (the camera dives through them) */
  update(time: number, calm: boolean, spread = 1) {
    for (const it of this.items) {
      const span = 48
      let x = it.x0 + (calm ? 0 : time * it.speed)
      x = ((((x + span / 2) % span) + span) % span) - span / 2
      it.m.position.x = Math.round(x * spread * 20) / 20
      it.m.position.z = it.z0 * spread
    }
  }
}

/* ------------------------------------------------------------------ boat */

/** a little sailboat bobbing by the dock (2 fps bob, like a tile animation) */
export class Boat {
  mesh: THREE.Mesh
  private y0: number
  constructor(x: number, y: number, z: number) {
    const b = new Builder()
    b.outlineWidth = 0.025
    b.box(0, 0.02, 0, 0.62, 0.1, 0.3, R.wood, true, true)
    b.box(0, 0.12, 0, 0.86, 0.14, 0.4, R.plank, true)
    b.box(-0.38, 0.2, 0, 0.12, 0.1, 0.3, R.plank, true)
    b.box(0.02, 0.26, 0, 0.04, 0.8, 0.04, R.metal, true)
    // stepped sail (reads as a triangle)
    for (let i = 0; i < 4; i++) b.box(0.08 + (0.36 - i * 0.08) / 2, 0.36 + i * 0.16, 0, 0.36 - i * 0.08, 0.16, 0.03, R.white, true)
    b.box(-0.12, 0.9, 0, 0.18, 0.1, 0.02, R.heart)
    this.mesh = b.mesh()
    this.mesh.position.set(x, y, z)
    this.y0 = y
  }
  update(time: number, calm: boolean) {
    const f = calm ? 0 : Math.floor(time * 2) % 2
    this.mesh.position.y = this.y0 + f * 0.04
    this.mesh.rotation.z = calm ? 0 : (f * 2 - 1) * 0.04
  }
}
