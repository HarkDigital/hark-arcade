import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { GeoBuilder, vertexFlat } from './geo'

/*
 * Player 1: a small signal-green critter with big listening ears (Hark means
 * listen). Built from chunky boxes so the CRT pass turns it into a sprite.
 * Faces +z; origin at its feet. The chapter poses it every frame from
 * scroll-derived state (walk phase, hop, facing) plus a little idle on
 * game-frame steps.
 */

/** a small player at a big machine */
export const SCALE = 0.66

export class Critter {
  group = new THREE.Group()
  /** everything that bobs */
  body = new THREE.Group()
  private earL = new THREE.Group()
  private earR = new THREE.Group()
  private footL: THREE.Mesh
  private footR: THREE.Mesh
  /** raycast proxy */
  hit: THREE.Mesh
  shadow: THREE.Mesh

  constructor(radial: THREE.Texture) {
    const mat = vertexFlat()
    const b = new GeoBuilder()
    const G = P.signal
    const D = P.green
    // rounded blob body (stacked boxes = pixel-art rounded corners)
    b.box(0.62, 0.5, 0.5, 0, 0.47, 0, G)
    b.box(0.5, 0.08, 0.42, 0, 0.76, 0, G)
    b.box(0.34, 0.04, 0.3, 0, 0.82, 0, G)
    b.box(0.5, 0.06, 0.42, 0, 0.19, 0, D)
    b.box(0.07, 0.36, 0.42, -0.34, 0.47, 0, G)
    b.box(0.07, 0.36, 0.42, 0.34, 0.47, 0, G)
    // face
    b.box(0.3, 0.2, 0.02, 0, 0.36, 0.255, P.cream)
    b.box(0.11, 0.15, 0.02, -0.13, 0.57, 0.256, P.white)
    b.box(0.11, 0.15, 0.02, 0.13, 0.57, 0.256, P.white)
    b.box(0.055, 0.09, 0.02, -0.11, 0.555, 0.27, P.void)
    b.box(0.055, 0.09, 0.02, 0.15, 0.555, 0.27, P.void)
    b.box(0.07, 0.035, 0.02, -0.25, 0.47, 0.256, P.coral)
    b.box(0.07, 0.035, 0.02, 0.25, 0.47, 0.256, P.coral)
    b.box(0.08, 0.025, 0.02, 0.02, 0.465, 0.258, P.void)
    // arms + tail
    b.box(0.09, 0.16, 0.12, -0.37, 0.42, 0.06, D)
    b.box(0.09, 0.16, 0.12, 0.37, 0.42, 0.06, D)
    b.box(0.12, 0.12, 0.06, 0, 0.3, -0.27, P.cream)
    // a "1P" stripe on its back (read while it plays a cabinet)
    b.box(0.34, 0.06, 0.02, 0, 0.6, -0.256, P.gold)
    const bodyMesh = new THREE.Mesh(b.build(), mat)
    this.body.add(bodyMesh)

    const ear = (side: number) => {
      const e = new GeoBuilder()
      e.box(0.13, 0.42, 0.09, 0, 0.21, 0, G)
      e.box(0.06, 0.28, 0.02, 0, 0.2, 0.05, P.magenta)
      e.box(0.13, 0.07, 0.09, 0, 0.4, 0, D)
      const m = new THREE.Mesh(e.build(), mat)
      const holder = side < 0 ? this.earL : this.earR
      holder.add(m)
      holder.position.set(0.17 * side, 0.78, 0)
      this.body.add(holder)
    }
    ear(-1)
    ear(1)

    const foot = () => {
      const f = new GeoBuilder()
      f.box(0.2, 0.1, 0.26, 0, 0.05, 0.02, D)
      return new THREE.Mesh(f.build(), mat)
    }
    this.footL = foot()
    this.footR = foot()
    this.footL.position.x = -0.15
    this.footR.position.x = 0.15
    this.group.add(this.body, this.footL, this.footR)

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.6), new THREE.MeshBasicMaterial({ visible: false }))
    this.hit.position.y = 0.6
    this.body.add(this.hit)

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.55),
      new THREE.MeshBasicMaterial({ map: radial, color: P.void, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 1
  }

  /**
   * Pose it. `step` = walk frame (integer, or -1 when standing), `air` =
   * mid-jump (legs tucked, ears streaming), `squash` 0..1 = landing squash,
   * `yaw` = facing, `perk` 0..1 = ears up (listening), `idle` = game-frame
   * counter for the idle bob, `ground` = height of the surface under it.
   */
  pose(
    x: number,
    y: number,
    z: number,
    ground: number,
    o: { step: number; air: boolean; squash: number; yaw: number; perk: number; idle: number; wiggle: number },
  ) {
    this.group.position.set(x, y, z)
    this.group.rotation.y = o.yaw
    const walking = o.step >= 0 && !o.air
    const odd = walking ? o.step % 2 : 0
    this.body.position.y = walking ? odd * 0.035 : o.idle % 2 ? 0.02 : 0
    this.footL.position.y = o.air ? 0.1 : walking && odd === 0 ? 0.07 : 0
    this.footR.position.y = o.air ? 0.04 : walking && odd === 1 ? 0.07 : 0
    this.footL.position.z = o.air ? 0.08 : walking ? (odd === 0 ? 0.06 : -0.04) : 0
    this.footR.position.z = o.air ? -0.08 : walking ? (odd === 1 ? 0.06 : -0.04) : 0
    // ears: relaxed tilt outward, perk up when listening, stream back mid-jump
    const relax = 0.34 - 0.2 * o.perk
    const flop = walking ? (odd ? 0.08 : -0.02) : 0
    const wig = o.wiggle
    this.earL.rotation.z = relax + flop + wig + (o.air ? 0.2 : 0)
    this.earR.rotation.z = -relax - flop + wig - (o.air ? 0.2 : 0)
    this.earL.rotation.x = o.air ? -0.5 : walking ? -0.12 : 0
    this.earR.rotation.x = o.air ? -0.5 : walking ? -0.12 : 0
    const s = 1 + o.perk * 0.1
    this.earL.scale.y = s
    this.earR.scale.y = s
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
