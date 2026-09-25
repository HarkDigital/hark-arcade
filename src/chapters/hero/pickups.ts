import * as THREE from 'three'
import { P, pixelText, sprite, voxels } from '../../kit/pixel'
import { rng } from '../../core/math'
import { gemGeometry } from './mark'
import { markFlyZ, trailX, trailY } from './layout'
import { stepped } from './util'

/*
 * Pickups for the flight: a trail of voxel coins the mark collects (pop +
 * sparkle burst + a floating "+100"), cyan gems streaming past in the side
 * lanes, and a shared pool of pixel sparkles. Everything is instanced, and
 * every state is derived from where the mark is on the trail (local), so a
 * jump lands on exactly the right coins collected.
 */

const COIN = ['.oooo.', 'oggggo', 'ogwgGo', 'ogwgGo', 'ogwgGo', 'ogwgGo', 'oggggo', '.oooo.']
const COIN_MAP = { o: P.gold, g: P.gold, w: P.white, G: P.orange }
const SPARK = ['...w...', '...w...', '..www..', 'wwwwwww', '..www..', '...w...', '...w...']
/** mark travel (world units) over which a collected coin pops */
const POP = 1.6

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _p2 = new THREE.Vector3()
const _e = new THREE.Euler()
const _c = new THREE.Color()

export class Sparkles {
  mesh: THREE.InstancedMesh
  private n = 0
  private max: number
  constructor(max = 72) {
    this.max = max
    const s = sprite(SPARK, { w: P.white }, { pixelSize: 0.05 })
    this.mesh = new THREE.InstancedMesh(s.geometry, s.material as THREE.Material, max)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.setColorAt(0, _c.set(P.white))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
  }
  begin() {
    this.n = 0
  }
  add(p: THREE.Vector3, size: number, color: string, quat: THREE.Quaternion) {
    if (this.n >= this.max || size <= 0.001) return
    _m.compose(p, quat, _s.setScalar(size))
    this.mesh.setMatrixAt(this.n, _m)
    this.mesh.setColorAt(this.n, _c.set(color))
    this.n++
  }
  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

/** sprite-frame sizes of a sparkle twinkle (12 fps) */
const TWINKLE = [0.35, 0.8, 1.15, 0.8, 1, 0.55, 0.3]
export function twinkle(t: number) {
  if (t < 0) return 0
  const i = Math.floor(t * 12)
  return i < TWINKLE.length ? TWINKLE[i] : 0
}

export class Pickups {
  group = new THREE.Group()
  sparkles = new Sparkles()
  private coinMeshes: THREE.InstancedMesh[] = []
  private gemMesh: THREE.InstancedMesh
  private coinZ: number[] = []
  private gems: { p: THREE.Vector3; ph: number }[] = []
  private texts: THREE.Mesh[] = []
  /** instance index reserved for the intro coin */
  private introIdx: number

  constructor(mobile: boolean) {
    // coin trail: runs of five, collected between local ~0.24 and ~0.47
    // (the flight hands over to the payoff swoop at ~0.49)
    const zA = markFlyZ(0.24)
    const zB = markFlyZ(0.47)
    let z = zA
    let i = 0
    const gap = mobile ? 3.1 : 2.4
    while (z > zB) {
      this.coinZ.push(z)
      z -= i % 5 === 4 ? gap * 2.6 : gap
      i++
    }
    this.introIdx = this.coinZ.length
    // unlit: exact palette colours, the spin reads from the silhouette (like a sprite)
    const coin = voxels(COIN, COIN_MAP, { size: 0.1, depth: 2, material: c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }) })
    for (const child of coin.children) {
      const src = child as THREE.Mesh
      const im = new THREE.InstancedMesh(src.geometry, src.material as THREE.Material, this.coinZ.length + 1)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.frustumCulled = false
      this.coinMeshes.push(im)
      this.group.add(im)
    }

    // gems in the side lanes
    const r = rng(77)
    const nGems = mobile ? 7 : 14
    const gA = markFlyZ(0.2)
    const gB = markFlyZ(0.56)
    for (let k = 0; k < nGems; k++) {
      const side = k % 2 ? 1 : -1
      const gz = gA + ((gB - gA) * (k + r() * 0.6)) / nGems
      this.gems.push({ p: new THREE.Vector3(trailX(gz) * 0.5 + side * (3.4 + r() * 3.2), 0.9 + r() * 2.6, gz), ph: r() * 10 })
    }
    this.gemMesh = new THREE.InstancedMesh(gemGeometry(0.2, 0.26, 0.18), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), nGems)
    this.gemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.gemMesh.frustumCulled = false
    this.group.add(this.gemMesh)

    for (let k = 0; k < 3; k++) {
      const t = pixelText(' +100 ', { font: 'silkscreen', px: 16, color: P.gold, bg: P.void, height: 0.34 })
      t.visible = false
      t.renderOrder = 6
      this.texts.push(t)
      this.group.add(t)
    }
    this.group.add(this.sparkles.mesh)
  }

  private setCoin(i: number, p: THREE.Vector3, rotY: number, s: number) {
    _q.setFromEuler(_e.set(0, rotY, 0))
    _m.compose(p, _q, _s.setScalar(s))
    for (const m of this.coinMeshes) m.setMatrixAt(i, _m)
  }

  /**
   * @param local chapter progress
   * @param time idle clock
   * @param camQuat billboard orientation
   * @param wFly flight rig weight (coins only show while flying)
   * @param intro the intro coin: position + 0..1 life, or null
   */
  update(local: number, time: number, camQuat: THREE.Quaternion, wFly: number, intro: { p: THREE.Vector3; life: number; scale: number } | null, reduced: boolean) {
    const sp = this.sparkles
    const markZ = markFlyZ(local)
    const st = stepped(time, 10)
    const show = wFly > 0.02
    let text = 0
    for (let i = 0; i < this.coinZ.length; i++) {
      const cz = this.coinZ[i]
      const u = (cz - markZ) / POP
      _p.set(trailX(cz), trailY(cz), cz)
      if (!show || u >= 0.5) {
        this.setCoin(i, _p, 0, 0)
      } else if (u < 0) {
        _p.y += Math.sin(st * 3 + i) * 0.06
        // sprite spin: 8 frames per turn at 10 fps
        this.setCoin(i, _p, Math.floor(time * 10 + i * 3) * (Math.PI / 4), 1)
      } else {
        // collected: rides just behind the mark, zips up out of it and shrinks away
        _p.y += 0.3 + u * 2.4
        _p.z = markZ - 0.5
        this.setCoin(i, _p, u * 12, Math.max(0, 1 - u * 1.6))
      }
      if (show && u >= 0 && u < 1.4) {
        // sparkle burst: four rays flying out (at the mark's depth)
        _p.z = markZ + 0.2
        const k = u / 1.4
        const size = twinkle(k * 0.55) * (reduced ? 0.7 : 1)
        for (let a = 0; a < 4; a++) {
          const ang = (a / 4) * Math.PI * 2 + 0.6
          _p2.copy(_p)
          _p2.x += Math.cos(ang) * k * 0.9
          _p2.y += Math.sin(ang) * k * 0.9 - u * 0.5
          sp.add(_p2, size, a % 2 ? P.gold : P.cyan, camQuat)
        }
      }
      if (show && u >= 0 && u < 2.4 && text < this.texts.length) {
        // rides along with the mark (same depth) as it floats up
        const t = this.texts[text++]
        t.position.set(trailX(cz), trailY(cz) + 0.55 + Math.floor(u * 5) * 0.08, markZ + 0.4)
        t.quaternion.copy(camQuat)
        // blink out on the way up (stepped)
        t.visible = u < 1.6 || Math.floor(u * 8) % 2 === 0
      }
    }
    for (let k = text; k < this.texts.length; k++) this.texts[k].visible = false

    // intro coin (pops out of the mark on the title screen)
    if (intro && intro.life > 0 && intro.life < 1) {
      this.setCoin(this.introIdx, intro.p, Math.floor(time * 16) * (Math.PI / 4), intro.scale)
    } else this.setCoin(this.introIdx, _p.set(0, -99, 0), 0, 0)
    for (const m of this.coinMeshes) m.instanceMatrix.needsUpdate = true

    // gems stream past
    for (let k = 0; k < this.gems.length; k++) {
      const g = this.gems[k]
      _p.copy(g.p)
      _p.y += Math.sin(st * 2 + g.ph) * 0.1
      const s = show ? 1 : 0
      _q.setFromEuler(_e.set(0, Math.floor(time * 8 + g.ph) * (Math.PI / 4), 0))
      _m.compose(_p, _q, _s.setScalar(s))
      this.gemMesh.setMatrixAt(k, _m)
    }
    this.gemMesh.instanceMatrix.needsUpdate = true
  }
}
