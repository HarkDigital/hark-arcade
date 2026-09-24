/** Awaitable yield between heavy init steps (hidden-tab safe; see core/yield). */
export type Yielder = () => Promise<void>

/** Snap a clock to sprite frames (e.g. 12 fps) so idle motion reads as pixel animation. */
export const stepped = (t: number, fps: number) => Math.floor(t * fps) / fps

/** 0 → 1 → 0 bump over [a, b]. */
export const bump = (t: number, a: number, b: number) => {
  if (t <= a || t >= b) return 0
  return Math.sin(((t - a) / (b - a)) * Math.PI)
}

/**
 * A falling drop with bounces (time in seconds from release). Returns the
 * height above rest in units of the drop height, plus how hard it's squashing
 * (1 right at an impact, decaying quickly).
 */
export function bounceDrop(t: number, fall = 0.36) {
  if (t <= 0) return { y: 1, squash: 0, landed: false }
  // arcs: the fall, then two smaller hops (heights 16% and 4%)
  const hops = [0.16, 0.04]
  if (t < fall) {
    const u = t / fall
    return { y: 1 - u * u, squash: 0, landed: false }
  }
  let t0 = fall
  for (const h of hops) {
    const dur = fall * Math.sqrt(h) * 2
    if (t < t0 + dur) {
      const u = (t - t0) / dur
      const y = h * 4 * u * (1 - u)
      const since = t - t0
      return { y, squash: Math.max(0, 1 - since / 0.09) * (h === hops[0] ? 1 : 0.5), landed: true }
    }
    t0 += dur
  }
  return { y: 0, squash: Math.max(0, 1 - (t - t0) / 0.09) * 0.25, landed: true }
}

/** Standard overshoot ease (snappy tween that pops past and settles). */
export function outBack(t: number, s = 1.9) {
  const u = t - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}
