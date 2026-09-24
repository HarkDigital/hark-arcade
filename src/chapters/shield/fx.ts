import * as THREE from 'three'
import { P, sprite, toon } from '../../kit/pixel'
import { fract, hash1, stepq } from './timeline'

/*
 * Game-feel particles and projectiles, all instanced:
 *   Pixels   square pixel particles (sparks, dust, fireworks, +HP)
 *   Bullets  the boss's red orb patterns (fans, snakes, sprays), time-looped;
 *            they pop on the site or glance off the shield
 *   Shots    the player's counter-fire: little Hark diamonds
 *   Pops     4-frame sprite explosions
 *   Debris   voxel chunks of the boss, ballistic with bounces
 *   Coins    loot: arcs, bounces, then idles spinning on 8 frames
 */

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const _e = new THREE.Euler()

function instanced(mesh: THREE.Mesh, count: number) {
  const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, count)
  im.frustumCulled = false
  im.count = 0
  return im
}

/* ------------------------------------------------------------ pixels */

export class Pixels {
  mesh: THREE.InstancedMesh
  private n = 0
  constructor(cap: number) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      cap,
    )
    this.mesh.frustumCulled = false
    this.mesh.setColorAt(0, _c.set('#ffffff'))
    this.mesh.count = 0
    this.mesh.renderOrder = 4
  }
  begin() {
    this.n = 0
  }
  push(x: number, y: number, z: number, size: number, color: string | THREE.Color, k = 1) {
    if (this.n >= this.mesh.instanceMatrix.count || size <= 0.002) return
    _p.set(x, y, z)
    _s.set(size, size, 1)
    _q.identity()
    _m.compose(_p, _q, _s)
    this.mesh.setMatrixAt(this.n, _m)
    if (typeof color === 'string') _c.set(color)
    else _c.copy(color)
    this.mesh.setColorAt(this.n, _c.multiplyScalar(k))
    this.n++
  }
  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

/** four sparks bursting from a point; e 0..1 */
export function sparks(px: Pixels, x: number, y: number, z: number, e: number, color: string, seed: number, spread = 0.5, k = 1.4) {
  if (e < 0 || e >= 1) return
  const es = stepq(e, 6)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + seed * 2.1
    const r = es * spread * (0.7 + 0.3 * hash1(seed + i))
    px.push(x + Math.cos(a) * r, y + Math.sin(a) * r, z + 0.01, 0.075 * (1 - es * 0.7), color, k)
  }
}

/* ------------------------------------------------------------ bullets */

const BULLET = [
  '..ccc..',
  '.cooocc',
  'cowwocc',
  'cowoocc',
  'coooccc',
  '.ccccc.',
  '..ccc..',
]

export interface BulletCtx {
  time: number
  pace: number
  /** 0..1 how many bullets are live */
  presence: number
  src: THREE.Vector3
  target: THREE.Vector3
  /** when set, bullets glance off this circle (x, y centre, radius) */
  shield: { x: number; y: number; r: number } | null
  /** site hit circle */
  siteR: number
  px: Pixels
  /** shield cell heat (world cell positions) */
  heat?: { cells: { x: number; y: number }[]; ox: number; out: Float32Array }
}

export class Bullets {
  mesh: THREE.InstancedMesh
  private waves: number
  private per = 6
  static PERIOD = 2.3
  z = 0.62

  constructor(mobile: boolean) {
    this.waves = mobile ? 5 : 8
    const spr = sprite(BULLET, { c: P.coral, o: P.orange, w: P.gold }, { pixelSize: 0.05, glow: 1.0 })
    this.mesh = instanced(spr, this.waves * this.per)
    this.mesh.renderOrder = 5
  }

  /** returns how hard the site is being pelted right now (0..~2) */
  update(o: BulletCtx): number {
    const { time, src, target } = o
    const M = this.per
    const W = this.waves
    const dx0 = target.x - src.x
    const dy0 = target.y - src.y
    const d0 = Math.hypot(dx0, dy0)
    const ax = dx0 / d0
    const ay = dy0 / d0
    const LMAX = d0 * 2
    let n = 0
    let jiggle = 0
    if (o.heat) o.heat.out.fill(0)
    if (o.presence <= 0.001) {
      this.mesh.count = 0
      return 0
    }
    for (let w = 0; w < W; w++) {
      const cyc = time / Bullets.PERIOD + w / W
      const u = fract(cyc)
      const volley = Math.floor(cyc)
      const pat = (w + volley) % 3
      const tilt = (hash1(w * 3.3 + volley * 1.7) - 0.5) * 0.28
      for (let j = 0; j < M; j++) {
        const i = w * M + j
        if (hash1(i * 1.37 + 0.5) > o.presence) continue
        const jc = j - (M - 1) / 2
        // fan / wiggling stream / widening spray
        let a = tilt
        if (pat === 0) a += jc * 0.16
        else if (pat === 1) a += Math.sin(u * 8 + j * 0.9) * 0.14
        else a += jc * 0.24 * (1 - u * 0.4)
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const dx = ax * ca - ay * sa
        const dy = ax * sa + ay * ca
        const s = u * LMAX * (pat === 2 ? 0.88 + 0.12 * (j % 2) : 1) - (pat === 1 ? j * 0.34 : 0)
        if (s <= 0) continue
        // first thing this bullet meets: the shield / the site / the floor
        let sHit = Infinity
        let kind = 0 // 1 shield, 2 site, 3 floor
        if (o.shield) {
          const fx = src.x - o.shield.x
          const fy = src.y - o.shield.y
          const b = fx * dx + fy * dy
          const c = fx * fx + fy * fy - o.shield.r * o.shield.r
          const disc = b * b - c
          if (disc >= 0) {
            const s1 = -b - Math.sqrt(disc)
            if (s1 > 0 && s1 < sHit) {
              sHit = s1
              kind = 1
            }
          }
        } else {
          const fx = src.x - target.x
          const fy = src.y - target.y
          const b = fx * dx + fy * dy
          const c = fx * fx + fy * fy - o.siteR * o.siteR
          const disc = b * b - c
          if (disc >= 0) {
            const s1 = -b - Math.sqrt(disc)
            if (s1 > 0 && s1 < sHit) {
              sHit = s1
              kind = 2
            }
          }
        }
        if (dy < 0) {
          const sf = (src.y - 0.1) / -dy
          if (sf > 0 && sf < sHit) {
            sHit = sf
            kind = 3
          }
        }
        const z = this.z
        const blink = o.pace > 0 ? (Math.floor(time * 12 + i) % 2 ? 1 : 0.84) : 1
        if (s < sHit) {
          _p.set(src.x + dx * s, src.y + dy * s, z)
          _s.setScalar(blink * Math.min(1, s * 4 + 0.3))
          _q.identity()
          _m.compose(_p, _q, _s)
          this.mesh.setMatrixAt(n++, _m)
          continue
        }
        const hx = src.x + dx * sHit
        const hy = src.y + dy * sHit
        const after = s - sHit
        if (kind === 1 && o.shield) {
          // glance off: reflect about the dome normal, shrink away
          let nx = hx - o.shield.x
          let ny = hy - o.shield.y
          const nl = Math.hypot(nx, ny) || 1
          nx /= nl
          ny /= nl
          const dot = dx * nx + dy * ny
          const rx = dx - 2 * dot * nx
          const ry = dy - 2 * dot * ny
          if (after < 0.9) {
            _p.set(hx + rx * after * 0.8, hy + ry * after * 0.8, z)
            _s.setScalar(stepq(1 - after / 0.9, 4) * 0.9)
            _q.identity()
            _m.compose(_p, _q, _s)
            this.mesh.setMatrixAt(n++, _m)
          }
          sparks(o.px, hx, hy, z + 0.02, after / 0.7, P.signal, i, 0.55, 1.5)
          if (o.heat && after < 1.2) {
            const k = 1 - after / 1.2
            const cells = o.heat.cells
            for (let ci = 0; ci < cells.length; ci++) {
              const cx = o.heat.ox + cells[ci].x - hx
              const cy = cells[ci].y - hy
              const d = cx * cx + cy * cy
              if (d < 0.36) o.heat.out[ci] += k * (1 - Math.sqrt(d) / 0.6)
            }
          }
        } else {
          sparks(o.px, hx, hy, z + 0.02, after / 0.7, kind === 2 ? P.coral : P.magenta, i, 0.45, 1.4)
          if (kind === 2 && after < 0.5) jiggle += 1 - after / 0.5
        }
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    return jiggle
  }
}

/* ------------------------------------------------------------ shots */

const DIAMOND = ['...g...', '..ggg..', '.ggwgg.', 'gggwggg', '.ggggg.', '..ggg..', '...g...']

export class Shots {
  mesh: THREE.InstancedMesh
  private count: number
  static PERIOD = 1.15

  constructor(mobile: boolean) {
    this.count = mobile ? 7 : 10
    const spr = sprite(DIAMOND, { g: P.signal, w: P.cream }, { pixelSize: 0.046, glow: 1.1 })
    this.mesh = instanced(spr, this.count)
    this.mesh.renderOrder = 5
  }

  /** returns 0..1 how recently the core was struck */
  update(time: number, presence: number, from: THREE.Vector3, to: THREE.Vector3, px: Pixels): number {
    let n = 0
    let struck = 0
    if (presence <= 0.001) {
      this.mesh.count = 0
      return 0
    }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    for (let i = 0; i < this.count; i++) {
      if (hash1(i * 2.71 + 9) > presence) continue
      const u = fract(time / Shots.PERIOD + i / this.count)
      const side = i % 2 ? 1 : -1
      const arc = Math.sin(u * Math.PI) * 0.45 * side * (0.6 + 0.4 * hash1(i))
      if (u < 0.92) {
        const x = from.x + dx * u + nx * arc
        const y = from.y + dy * u + ny * arc
        // heading along the arc's tangent
        const tx = dx + nx * Math.cos(u * Math.PI) * Math.PI * 0.45 * side
        const ty = dy + ny * Math.cos(u * Math.PI) * Math.PI * 0.45 * side
        _e.set(0, 0, Math.atan2(ty, tx) - Math.PI / 2)
        _q.setFromEuler(_e)
        _p.set(x, y, 0.7)
        _s.set(0.9, 1.35, 1).multiplyScalar(Math.min(1, u * 8 + 0.2))
        _m.compose(_p, _q, _s)
        this.mesh.setMatrixAt(n++, _m)
      } else {
        const e = (u - 0.92) / 0.08
        sparks(px, to.x, to.y, 0.9, e, i % 3 ? P.gold : P.white, i * 3, 0.5, 1.6)
        struck = Math.max(struck, 1 - e)
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    return struck
  }
}

/* ------------------------------------------------------------ pops */

function popRows(f: number): string[] {
  const rows: string[] = []
  for (let y = 0; y < 11; y++) {
    let r = ''
    for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x - 5, y - 5)
      let ch = '.'
      if (f === 0) {
        if (d < 1.3) ch = 'w'
        else if ((x === 5 || y === 5) && d < 3.6) ch = 'g'
        else if (Math.abs(x - 5) === Math.abs(y - 5) && d < 2.3) ch = 'g'
      } else if (f === 1) {
        if (d < 1.8) ch = 'w'
        else if (d < 3.3) ch = 'g'
        else if (d < 4.8) ch = 'o'
      } else if (f === 2) {
        if (d >= 2.4 && d < 3.6) ch = 'o'
        else if (d >= 3.6 && d < 5.1) ch = 'c'
        else if (d < 1.2) ch = 'g'
      } else {
        if (d >= 3.8 && d < 5.3 && hash1(x * 11 + y * 7) > 0.45) ch = 'p'
        else if (d >= 2.6 && d < 3.8 && hash1(x * 5 + y * 13) > 0.7) ch = 'c'
      }
      r += ch
    }
    rows.push(r)
  }
  return rows
}

export class Pops {
  meshes: THREE.InstancedMesh[] = []
  private n = [0, 0, 0, 0]
  constructor() {
    const map = { w: P.white, g: P.gold, o: P.orange, c: P.coral, p: P.purple }
    for (let f = 0; f < 4; f++) {
      const spr = sprite(popRows(f), map, { pixelSize: 0.07, glow: f < 2 ? 1.6 : 1.1 })
      const im = instanced(spr, 20)
      im.renderOrder = 6
      this.meshes.push(im)
    }
  }
  begin() {
    this.n.fill(0)
  }
  /** a pop `age` seconds old (frames at `fps`), scale s */
  add(x: number, y: number, z: number, s: number, age: number, fps = 16) {
    if (age < 0) return
    const f = Math.floor(age * fps)
    if (f > 3) return
    const im = this.meshes[f]
    if (this.n[f] >= 20) return
    _p.set(x, y, z)
    _s.setScalar(s)
    _q.identity()
    _m.compose(_p, _q, _s)
    im.setMatrixAt(this.n[f]++, _m)
  }
  end() {
    this.meshes.forEach((im, f) => {
      im.count = this.n[f]
      im.instanceMatrix.needsUpdate = true
    })
  }
}

/* ------------------------------------------------------------ ballistic helper */

/** height after t seconds for a bouncing body (up to 3 bounces), resting at `floor` */
function bounceY(y0: number, vy: number, g: number, t: number, floor: number, rest: number) {
  let y = y0
  let v = vy
  let tt = t
  for (let b = 0; b < 4; b++) {
    const h = y - floor
    const tl = (v + Math.sqrt(Math.max(0, v * v + 2 * g * h))) / g
    if (tt < tl) return y + v * tt - 0.5 * g * tt * tt
    tt -= tl
    v = (g * tl - v) * rest
    y = floor
    if (v < 0.4) return floor
  }
  return floor
}
/** time until the first landing */
function landT(y0: number, vy: number, g: number, floor: number) {
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * (y0 - floor)))) / g
}

/* ------------------------------------------------------------ debris */

export class Debris {
  mesh: THREE.InstancedMesh
  private parts: { o: THREE.Vector3; v: THREE.Vector3; s: number; c: THREE.Color; spin: number }[] = []

  constructor(samples: { p: THREE.Vector3; c: string }[], mobile: boolean) {
    const n = mobile ? 60 : 110
    const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toon('#ffffff').gradientMap })
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    for (let i = 0; i < n; i++) {
      const smp = samples[Math.floor(hash1(i * 4.13 + 1) * samples.length) % samples.length]
      const o = smp.p.clone()
      const dir = o.clone().normalize()
      const sp = 2.2 + hash1(i * 2.9) * 3.2
      const v = new THREE.Vector3(dir.x * sp, Math.abs(dir.y) * sp * 0.6 + 2.5 + hash1(i * 6.1) * 3, dir.z * sp * 0.6 + 0.8)
      this.parts.push({ o, v, s: 0.09 + hash1(i * 8.3) * 0.1, c: new THREE.Color(smp.c), spin: (hash1(i * 3.3) - 0.5) * 16 })
      this.mesh.setColorAt(i, this.parts[i].c)
    }
  }

  /** t seconds since the burst, from the body centre `at` (world) */
  update(t: number, at: THREE.Vector3) {
    if (t < 0 || t > 2.6) {
      this.mesh.count = 0
      return
    }
    const g = 11
    let n = 0
    for (const d of this.parts) {
      const k = 1 - Math.exp(-1.6 * t)
      const x = at.x + d.o.x + (d.v.x * k) / 1.6
      const z = at.z + d.o.z + (d.v.z * k) / 1.6
      const y = bounceY(at.y + d.o.y, d.v.y, g, t, d.s / 2, 0.35)
      const shrink = t < 1.6 ? 1 : Math.max(0, 1 - (t - 1.6) / 1.0)
      const sc = d.s * stepq(shrink, 4)
      if (sc <= 0.001) continue
      const r = stepq(t * d.spin, 1 / (Math.PI / 4))
      _e.set(r, r * 0.7, 0)
      _q.setFromEuler(_e)
      _p.set(x, y, z)
      _s.setScalar(sc)
      _m.compose(_p, _q, _s)
      this.mesh.setMatrixAt(n, _m)
      this.mesh.setColorAt(n, d.c)
      n++
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

/* ------------------------------------------------------------ coins */

export class Coins {
  mesh: THREE.InstancedMesh
  private list: { x0: number; xT: number; zT: number; vy: number; delay: number; ph: number }[] = []
  static R = 0.15

  constructor(mobile: boolean) {
    const n = mobile ? 10 : 16
    const geo = new THREE.CylinderGeometry(Coins.R, Coins.R, 0.06, 10)
    geo.rotateX(Math.PI / 2)
    const mat = new THREE.MeshToonMaterial({
      color: P.gold,
      gradientMap: toon('#ffffff').gradientMap,
      emissive: new THREE.Color(P.orange),
      emissiveIntensity: 0.25,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, n)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    for (let i = 0; i < n; i++) {
      this.list.push({
        x0: (hash1(i * 1.9) - 0.5) * 1.2,
        xT: 0,
        zT: -0.7 + hash1(i * 5.7) * 2.1,
        vy: 4.2 + hash1(i * 3.1) * 2.6,
        delay: hash1(i * 7.3) * 0.18,
        ph: hash1(i * 2.2),
      })
    }
  }

  /** landing spots spread across [xa, xb] (world) */
  layout(xa: number, xb: number) {
    const n = this.list.length
    this.list.forEach((c, i) => {
      c.xT = xa + ((i + 0.5) / n) * (xb - xa) + (hash1(i * 4.4) - 0.5) * 0.35
    })
  }

  /** t seconds since the burst, from `at` (world) */
  update(t: number, time: number, pace: number, at: THREE.Vector3) {
    if (t < 0) {
      this.mesh.count = 0
      return
    }
    const g = 12
    const floor = Coins.R + 0.02
    let n = 0
    for (const c of this.list) {
      const tt = t - c.delay
      if (tt < 0) continue
      const y0 = at.y
      const tl = landT(y0, c.vy, g, floor)
      const k = Math.min(1, tt / tl)
      const x = at.x + c.x0 + (c.xT - at.x - c.x0) * k
      const z = at.z + (c.zT - at.z) * k
      let y = bounceY(y0, c.vy, g, tt, floor, 0.42)
      // once settled: a small idle hover like a real pickup
      if (tt > tl + 1.2 && pace > 0) y += Math.round(Math.sin(time * 3 + c.ph * 6) * 2) * 0.02
      const spin = pace > 0 ? stepq(time * 1.3 + c.ph, 8) * Math.PI * 2 : 0.6
      _e.set(0, spin, 0)
      _q.setFromEuler(_e)
      _p.set(x, y, z)
      _s.setScalar(1)
      _m.compose(_p, _q, _s)
      this.mesh.setMatrixAt(n++, _m)
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
