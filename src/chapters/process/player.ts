import * as THREE from 'three'
import { P, glow } from '../../kit/pixel'
import { Builder, R } from './builder'

/*
 * Player 1: a chunky voxel kid in signal green with big headphones (Hark =
 * listen). Walk cycle is 4 sprite frames keyed to DISTANCE walked (so legs
 * only move when the token moves, and any scroll position poses exactly);
 * idle breathing and the victory hop are stepped at console frame rates.
 */

const LEG = [0.07, 0, -0.07, 0]
const LIFT = [0.03, 0, 0, 0]

export class Player {
  root = new THREE.Group()
  private body: THREE.Mesh
  private legL: THREE.Mesh
  private legR: THREE.Mesh
  private armL: THREE.Mesh
  private armR: THREE.Mesh
  private marker: THREE.Mesh
  private shadow: THREE.Mesh
  private rig = new THREE.Group()
  private lean = new THREE.Group()

  constructor() {
    const b = new Builder()
    b.outlineWidth = 0.028
    // torso
    b.box(0, 0.15, 0, 0.34, 0.26, 0.24, R.player, true)
    b.box(0, 0.15, 0.125, 0.2, 0.05, 0.01, R.dark)
    // head
    b.box(0, 0.4, 0, 0.4, 0.34, 0.34, R.face, true)
    // cap (set back so the face reads from above)
    b.box(0, 0.72, -0.04, 0.42, 0.09, 0.3, R.signal, true)
    b.box(0, 0.7, 0.14, 0.34, 0.04, 0.1, R.signal, true)
    // eyes
    for (const s of [-1, 1]) b.box(s * 0.085, 0.53, 0.172, 0.05, 0.09, 0.01, R.void)
    // cheeks
    for (const s of [-1, 1]) b.box(s * 0.14, 0.48, 0.172, 0.05, 0.03, 0.01, R.flower)
    // headphones: band over the cap, big magenta cups
    b.box(0, 0.8, -0.02, 0.5, 0.06, 0.08, R.dark, true)
    for (const s of [-1, 1]) {
      b.box(s * 0.225, 0.74, -0.02, 0.06, 0.08, 0.08, R.dark)
      b.box(s * 0.24, 0.44, -0.02, 0.08, 0.2, 0.2, R.roofPurple, true)
      b.box(s * 0.285, 0.48, -0.02, 0.02, 0.12, 0.12, R.heart)
    }
    this.body = b.mesh()
    const leg = () => {
      const l = new Builder()
      l.outlineWidth = 0.025
      l.box(0, 0, 0.01, 0.12, 0.17, 0.14, R.indigo, true)
      l.box(0, 0, 0.04, 0.13, 0.05, 0.16, R.dark)
      return l.mesh()
    }
    const arm = () => {
      const a = new Builder()
      a.outlineWidth = 0.025
      a.box(0, -0.18, 0, 0.08, 0.2, 0.1, R.player, true)
      a.box(0, -0.2, 0, 0.08, 0.05, 0.1, R.face)
      return a.mesh()
    }
    this.legL = leg()
    this.legR = leg()
    this.armL = arm()
    this.armR = arm()
    this.legL.position.x = -0.085
    this.legR.position.x = 0.085
    this.armL.position.set(-0.22, 0.38, 0)
    this.armR.position.set(0.22, 0.38, 0)
    this.rig.add(this.body, this.legL, this.legR, this.armL, this.armR)
    // lean back toward the (high) camera, like a sprite drawn front-on
    this.lean.rotation.x = -0.42
    this.lean.scale.setScalar(1.28)
    this.lean.add(this.rig)
    this.root.add(this.lean)

    // soft pixel shadow
    const sh = new THREE.Mesh(
      new THREE.CircleGeometry(0.26, 8),
      new THREE.MeshBasicMaterial({ color: P.void, transparent: true, opacity: 0.4, depthWrite: false }),
    )
    sh.rotation.x = -Math.PI / 2
    sh.rotation.z = Math.PI / 8
    sh.position.y = 0.012
    sh.scale.set(1, 0.7, 1)
    this.shadow = sh
    this.root.add(sh)

    // the "1P" cursor that bobs over the player
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 4, 1), glow(P.signal, 1.9))
    m.rotation.x = Math.PI
    m.rotation.y = Math.PI / 4
    this.marker = m
    this.root.add(m)
  }

  /**
   * Pose the player.
   *  dist     path distance walked (drives the walk frames)
   *  walking  moving along the path this frame
   *  yaw      facing (0 = toward the camera)
   *  hop      0..1 victory hop height (already stepped by the caller)
   *  cheer    arms up
   */
  pose(o: { dist: number; walking: boolean; yaw: number; time: number; calm: boolean; hop: number; cheer: boolean; marker: boolean }) {
    const f = o.walking ? Math.floor(o.dist / 0.16) % 4 : -1
    const idle = !o.walking && !o.calm ? Math.floor(o.time * 2) % 2 : 0
    const bob = f >= 0 ? (f % 2) * 0.035 : idle * 0.015
    this.rig.rotation.y = o.yaw
    const jump = o.hop * 0.42
    this.rig.position.y = bob + jump
    if (f >= 0) {
      this.legL.position.set(-0.085, LIFT[f], LEG[f])
      this.legR.position.set(0.085, LIFT[(f + 2) % 4], LEG[(f + 2) % 4])
      this.armL.rotation.x = -LEG[f] * 6
      this.armR.rotation.x = LEG[f] * 6
      this.armL.rotation.z = this.armR.rotation.z = 0
    } else {
      this.legL.position.set(-0.085, 0, 0)
      this.legR.position.set(0.085, 0, 0)
      this.armL.rotation.x = this.armR.rotation.x = 0
      this.armL.rotation.z = o.cheer ? -2.6 : 0
      this.armR.rotation.z = o.cheer ? 2.6 : 0
    }
    // shadow shrinks as the player leaves the ground
    this.shadow.scale.set(1 - o.hop * 0.35, 0.7 * (1 - o.hop * 0.35), 1)
    this.marker.visible = o.marker
    if (o.marker) this.marker.position.y = 1.36 + jump * 1.28 + (o.calm ? 0 : (Math.floor(o.time * 3) % 2) * 0.06)
  }
}
