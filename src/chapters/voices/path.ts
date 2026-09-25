import * as THREE from 'three'

/*
 * The walk through the village, on the tile grid (1 unit = 1 tile, x east,
 * z south — the camera looks north). The player enters from the south gate,
 * and for each testimonial walks up to a villager who stands just NORTH of
 * the stop (so the villager faces the camera and the player shows their back,
 * the classic JRPG "talk" composition). After each chat the road turns east or
 * west, then north again to the next villager.
 */

export const SPAWN = new THREE.Vector2(0, 7)

/** the fixed JRPG camera's downward tilt (it always looks north) */
export const EL = THREE.MathUtils.degToRad(48)

/** where the player stands to talk to villager k */
export const STOPS = [
  [0, 1],
  [-5, -5],
  [1, -12],
  [6, -18],
  [-1, -24],
  [-6, -30],
  [1, -36],
  [5, -42],
].map(([x, z]) => new THREE.Vector2(x, z))

/** villagers stand this far north of their stop */
export const NPC_GAP = 1.7

export const npcSpot = (k: number) => new THREE.Vector2(STOPS[k].x, STOPS[k].y - NPC_GAP)

/** A polyline walk with arc-length sampling. */
export class Leg {
  lens: number[] = []
  total = 0
  constructor(public pts: THREE.Vector2[]) {
    for (let i = 1; i < pts.length; i++) {
      const l = pts[i].distanceTo(pts[i - 1])
      this.lens.push(l)
      this.total += l
    }
  }
  /** position at distance d; writes the heading (unit xz) into `dir` */
  at(d: number, out: THREE.Vector2, dir?: THREE.Vector2) {
    let r = Math.max(0, Math.min(this.total, d))
    for (let i = 0; i < this.lens.length; i++) {
      const l = this.lens[i]
      if (r <= l || i === this.lens.length - 1) {
        const a = this.pts[i]
        const b = this.pts[i + 1]
        const t = l > 0 ? Math.min(1, r / l) : 1
        out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
        if (dir) dir.set(b.x - a.x, b.y - a.y).normalize()
        return out
      }
      r -= l
    }
    return out.copy(this.pts[this.pts.length - 1])
  }
}

/** leg k ends at stop k: the first comes straight up from the gate */
export const LEGS: Leg[] = STOPS.map((s, k) => {
  if (k === 0) return new Leg([SPAWN.clone(), s.clone()])
  const p = STOPS[k - 1]
  return new Leg([p.clone(), new THREE.Vector2(s.x, p.y), s.clone()])
})

/** every straight run of road (for painting path tiles), incl. the road in from the south */
export function roadSegments(): [THREE.Vector2, THREE.Vector2][] {
  const segs: [THREE.Vector2, THREE.Vector2][] = [[new THREE.Vector2(0, 17), SPAWN.clone()]]
  for (const leg of LEGS) for (let i = 1; i < leg.pts.length; i++) segs.push([leg.pts[i - 1], leg.pts[i]])
  return segs
}
