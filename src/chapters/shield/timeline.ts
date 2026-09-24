import { ease, segment } from '../../core/math'

/**
 * BOSS FIGHT — one scroll of a 16-bit boss battle ("Hacked? Breathe.").
 *
 *   0.00–0.10  in-beat: the iris opens on a WARNING! band while the malware
 *              boss drops into the arena and lands with a thud
 *   0.10–0.35  ATTACK: bullet fans rain on the little Hark website; its HP
 *              drops in chunks (shake + hit flash), the floor corrupts,
 *              'INTRUSION DETECTED' types out in a warning window
 *   0.35–0.40  the Hark SHIELD blooms: hex cells pop out from the site
 *   0.36–0.70  'Hacked? Breathe.' + the security copy in a dialogue window;
 *              bullets splash off the shield, the site fires Hark diamonds
 *              back, boss HP drains in stepped chunks
 *   0.70       the boss blows apart into voxels and coins (real-time playback)
 *   0.72–0.80  YOU WIN!, the site's HP refills, the floor is cleansed,
 *              24/7 + the CTA in a results window
 *   0.93–1.00  out-beat: the camera pushes in on the victorious site
 *
 * Every state derives from `local`; frame.time drives only idle loops
 * (bullets, legs, blinks, coins) and short real-time punches.
 */
export const T = {
  /** the boss falls into the arena */
  drop: [0.015, 0.095] as const,
  /** feet hit the floor */
  thud: 0.095,
  warning: [0.03, 0.115] as const,
  hp: 0.05,
  /** boss bullets in the air (thinning once the counterattack starts) */
  fire: [0.1, 0.665] as const,
  alert: [0.115, 0.345] as const,
  siteHits: [0.145, 0.185, 0.222, 0.26, 0.296, 0.332],
  shield: [0.35, 0.395] as const,
  title: 0.362,
  body: [0.376, 0.695] as const,
  shieldTag: [0.37, 0.47] as const,
  weakTag: [0.47, 0.64] as const,
  counter: [0.405, 0.692] as const,
  bossHits: [0.445, 0.494, 0.543, 0.592, 0.64, 0.688],
  boom: 0.7,
  refill: [0.722, 0.8] as const,
  win: 0.722,
  card: 0.735,
  /** where the CTA is settled (chapter.anchors) */
  cta: 0.8,
  out: [0.93, 1] as const,
}

/** fraction of site HP each hit takes */
const SITE_DMG = 0.12

export function siteHP(local: number) {
  let hp = 1
  for (const h of T.siteHits) if (local >= h) hp -= SITE_DMG
  if (local >= T.refill[0]) {
    const k = segment(local, T.refill[0], T.refill[1])
    hp += (1 - hp) * (Math.floor(k * 12) / 12)
  }
  return hp
}

export function bossHP(local: number) {
  let n = 0
  for (const h of T.bossHits) if (local >= h) n++
  return 1 - n / T.bossHits.length
}

/** how many site hits have landed (0..6) */
export function siteDamage(local: number) {
  let n = 0
  for (const h of T.siteHits) if (local >= h) n++
  return local >= T.refill[0] ? Math.round(n * (1 - segment(local, T.refill[0], T.refill[1]))) : n
}

export const fract = (x: number) => x - Math.floor(x)
/** cheap deterministic hash, 0..1 */
export const hash1 = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453)
/** snappy overshoot 0→1 (back-out), clamped */
export const pop = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : ease.outBack(u))
/** quantize to n steps per unit (sprite-style motion) */
export const stepq = (x: number, n: number) => Math.floor(x * n) / n
