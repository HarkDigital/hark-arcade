import { P } from './pixel'

/*
 * PLAYER 1 — one hero across every level. Each level draws the kid in its own
 * technique (side-view sprite, voxel figure, chibi folk), but always from this
 * spec, so the throughline reads as one character:
 *
 *   - signal-green hoodie with the HOOD UP (hood + sleeves in `hood`, the
 *     shaded side / hood lining in `hoodShade`)
 *   - HEADPHONES over the hood: `phonesBand` band, `phonesCup` cups
 *     (Hark = listen; the one prop Player 1 never takes off)
 *   - cream face, void dot eyes, coral cheeks
 *   - indigo trousers, white trainers
 *
 * No caps, no brown hair, no coral shirt. The Hark mark is the narrator
 * ('HARK' in dialogue), not Player 1; the arcade hall's mascot is Player 1 too.
 */
export const PLAYER1 = {
  hood: P.signal,
  hoodShade: P.green,
  face: P.cream,
  eyes: P.void,
  cheeks: P.coral,
  phonesBand: P.void,
  phonesCup: P.white,
  pants: P.indigo,
  shoes: P.white,
  outline: P.void,
} as const

/**
 * 12 x 12 face-on portrait (for dialogue windows, credits, the pause menu).
 * Use with kit/pixel.ts sprite(PLAYER1_PORTRAIT, PLAYER1_PORTRAIT_MAP, …).
 */
export const PLAYER1_PORTRAIT = [
  '...kkkkkk...',
  '..kGGGGGGk..',
  '.kGGggggGGk.',
  'wkGgccccgGkw',
  'wkgcvccvcgkw',
  'wkgcrccrcgkw',
  '.kgccccccgk.',
  '..kgccccgk..',
  '.kGGGGGGGGk.',
  'kGGgGGGGgGGk',
  'kGGgGGGGgGGk',
  'kkkkkkkkkkkk',
]
export const PLAYER1_PORTRAIT_MAP: Record<string, string> = {
  k: PLAYER1.outline,
  G: PLAYER1.hood,
  g: PLAYER1.hoodShade,
  c: PLAYER1.face,
  v: PLAYER1.eyes,
  r: PLAYER1.cheeks,
  w: PLAYER1.phonesCup,
}
