import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { PLAYER1 } from '../../kit/player1'
import { GeoBuilder, vertexFlat } from './geo'

/*
 * Player 1 (kit/player1.ts), voxel-built for the arcade hall: a chibi kid in
 * the signal-green hoodie with the hood up, headphones over the hood (void
 * band, white cups), cream face, void dot eyes, coral cheeks, indigo trousers,
 * white trainers. Chunky boxes with baked palette-ramp shading, so the CRT
 * pass turns it into a sprite.
 *
 * Faces +z; origin at its feet. The chapter poses it every frame from
 * scroll-derived state (walk phase, hop, facing) plus a little idle on
 * game-frame steps. Its reactions: a cheer (both arms up) when a machine
 * boots, then a hand to the headphones while it listens.
 */

/** a small player at a big machine */
export const SCALE = 0.66

const SHOULDER_X = 0.265
const SHOULDER_Y = 0.54
const NECK_Y = 0.56
/** arm raised to the headphone cup (rad) */
const TO_CUP = Math.PI - 0.3
/** arms thrown up in a V (rad) */
const CHEER = Math.PI - 0.55

export interface PoseOpts {
  /** walk frame (integer), or -1 when standing */
  step: number
  /** mid-jump: legs tucked, arms up */
  air: boolean
  /** landing squash 0..1 */
  squash: number
  /** facing */
  yaw: number
  /** 0..1: a hand goes to the headphones (listening to the machine) */
  perk: number
  /** 0..1: both arms up (a machine booting, LEVEL CLEAR, a poke) */
  cheer: number
  /** game-frame counter for the idle bob */
  idle: number
  /** head wobble (rad) */
  wiggle: number
}

export class Player1 {
  group = new THREE.Group()
  /** everything that bobs */
  body = new THREE.Group()
  private head = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private footL: THREE.Mesh
  private footR: THREE.Mesh
  /** raycast proxy */
  hit: THREE.Mesh
  shadow: THREE.Mesh

  constructor(radial: THREE.Texture) {
    const mat = vertexFlat()
    const C = PLAYER1

    // ---- hoodie body
    const b = new GeoBuilder()
    b.box(0.46, 0.3, 0.3, 0, 0.41, 0, C.hood)
    b.box(0.48, 0.05, 0.32, 0, 0.26, 0, C.hoodShade) // ribbed hem
    b.box(0.26, 0.08, 0.02, 0, 0.35, 0.155, C.hoodShade) // kangaroo pocket
    b.box(0.035, 0.06, 0.02, -0.07, 0.5, 0.156, P.cream) // drawstrings
    b.box(0.035, 0.06, 0.02, 0.07, 0.5, 0.156, P.cream)
    this.body.add(new THREE.Mesh(b.build(), mat))

    // ---- head: the hood up, the face in its opening, headphones over it
    const h = new GeoBuilder()
    // hood shell, rounded with stacked slabs (pixel-art corners)
    h.box(0.6, 0.44, 0.5, 0, 0.26, -0.01, C.hood)
    h.box(0.5, 0.05, 0.44, 0, 0.505, -0.01, C.hood)
    h.box(0.36, 0.035, 0.34, 0, 0.545, -0.02, C.hood)
    h.box(0.52, 0.06, 0.4, 0, 0.03, -0.03, C.hoodShade) // hood gathered at the neck
    // lining round the opening, then the face
    h.box(0.46, 0.36, 0.02, 0, 0.235, 0.245, C.hoodShade)
    h.box(0.36, 0.26, 0.02, 0, 0.215, 0.255, C.face)
    h.box(0.05, 0.08, 0.02, -0.08, 0.245, 0.266, C.eyes)
    h.box(0.05, 0.08, 0.02, 0.08, 0.245, 0.266, C.eyes)
    h.box(0.06, 0.035, 0.02, -0.135, 0.17, 0.266, C.cheeks)
    h.box(0.06, 0.035, 0.02, 0.135, 0.17, 0.266, C.cheeks)
    // headphones: the band arches over the hood, the cups sit on its sides
    h.box(0.36, 0.05, 0.09, 0, 0.585, 0, C.phonesBand)
    h.box(0.08, 0.06, 0.09, -0.225, 0.55, 0, C.phonesBand)
    h.box(0.08, 0.06, 0.09, 0.225, 0.55, 0, C.phonesBand)
    h.box(0.045, 0.2, 0.09, -0.3, 0.44, 0, C.phonesBand)
    h.box(0.045, 0.2, 0.09, 0.3, 0.44, 0, C.phonesBand)
    h.box(0.03, 0.24, 0.24, -0.32, 0.26, 0, C.phonesBand) // cup backs
    h.box(0.03, 0.24, 0.24, 0.32, 0.26, 0, C.phonesBand)
    h.box(0.09, 0.2, 0.2, -0.375, 0.26, 0, C.phonesCup)
    h.box(0.09, 0.2, 0.2, 0.375, 0.26, 0, C.phonesCup)
    this.head.add(new THREE.Mesh(h.build(), mat))
    this.head.position.y = NECK_Y
    this.body.add(this.head)

    // ---- arms: sleeve, cuff, hand; pivot at the shoulder
    const arm = (side: number) => {
      const a = new GeoBuilder()
      a.box(0.11, 0.2, 0.13, 0, -0.1, 0, C.hood)
      a.box(0.12, 0.04, 0.14, 0, -0.215, 0, C.hoodShade)
      a.box(0.1, 0.08, 0.1, 0, -0.27, 0, C.face)
      const holder = side < 0 ? this.armL : this.armR
      holder.add(new THREE.Mesh(a.build(), mat))
      holder.position.set(SHOULDER_X * side, SHOULDER_Y, 0)
      this.body.add(holder)
    }
    arm(-1)
    arm(1)

    // ---- legs: trouser leg + trainer
    const leg = () => {
      const f = new GeoBuilder()
      f.box(0.14, 0.17, 0.16, 0, 0.155, 0, C.pants)
      f.box(0.17, 0.08, 0.25, 0, 0.04, 0.035, C.shoes)
      return new THREE.Mesh(f.build(), mat)
    }
    this.footL = leg()
    this.footR = leg()
    this.footL.position.x = -0.12
    this.footR.position.x = 0.12
    this.group.add(this.body, this.footL, this.footR)

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.25, 0.6), new THREE.MeshBasicMaterial({ visible: false }))
    this.hit.position.y = 0.6
    this.body.add(this.hit)

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.55),
      new THREE.MeshBasicMaterial({ map: radial, color: P.void, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 1
  }

  /** Pose it; `ground` = height of the surface under it (for the shadow). */
  pose(x: number, y: number, z: number, ground: number, o: PoseOpts) {
    this.group.position.set(x, y, z)
    this.group.rotation.y = o.yaw
    const walking = o.step >= 0 && !o.air
    const odd = walking ? o.step % 2 : 0
    this.body.position.y = walking ? odd * 0.035 : o.idle % 2 ? 0.02 : 0
    this.footL.position.y = o.air ? 0.1 : walking && odd === 0 ? 0.07 : 0
    this.footR.position.y = o.air ? 0.04 : walking && odd === 1 ? 0.07 : 0
    this.footL.position.z = o.air ? 0.08 : walking ? (odd === 0 ? 0.06 : -0.04) : 0
    this.footR.position.z = o.air ? -0.08 : walking ? (odd === 1 ? 0.06 : -0.04) : 0

    // arms: swing on the walk frames, up in a V mid-jump or cheering, and one
    // hand to the headphones while it listens (the near-side hand when it
    // turns to us; quantised to sprite frames)
    const cheer = o.air ? 1 : o.cheer
    const perk = Math.round(o.perk * 3) / 3
    const swing = walking ? (odd ? 0.55 : -0.55) : 0
    let aL = 0.1 + (TO_CUP - 0.1) * perk
    let aR = 0.1
    aL += (CHEER - aL) * cheer
    aR += (CHEER - aR) * cheer
    this.armL.rotation.set(swing * (1 - cheer) + 0.45 * perk * (1 - cheer), 0, -aL)
    this.armR.rotation.set(-swing * (1 - cheer), 0, aR)

    // head: wobble, a tilt toward the raised hand while listening, tuck mid-jump
    this.head.rotation.z = o.wiggle + 0.1 * perk * (1 - cheer)
    this.head.rotation.x = o.air ? -0.12 : 0

    // squash on landing, stretch in the air
    const sq = o.squash
    const st = o.air ? 0.08 : 0
    this.group.scale.set(SCALE * (1 + sq * 0.18 - st * 0.5), SCALE * (1 - sq * 0.24 + st), SCALE * (1 + sq * 0.18 - st * 0.5))
    // shadow on whatever is under it, shrinking with height
    this.shadow.position.set(x, ground + 0.012, z)
    const k = Math.max(0.3, 1 - (y - ground) * 0.45) * SCALE
    this.shadow.scale.set(k, k, 1)
  }
}
