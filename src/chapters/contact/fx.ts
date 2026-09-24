import { P } from '../../kit/pixel'
import { logoOutlinePoints } from '../../logo/logo'

/*
 * 2D pixel effects drawn straight into the game-resolution layer (one texel
 * = one game pixel): twinkling parallax stars, the heartbeat ring, sparkle
 * bursts and the credits fireworks. Everything is a pure function of time
 * (stepped to 12 fps, like sprite animation) plus a few scroll-derived
 * inputs, so any frame can be rendered cold.
 */

export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const hash2 = (a: number, b: number) => hash(a * 57.31 + b * 13.17)

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Ctx = CanvasRenderingContext2D

function dot(ctx: Ctx, x: number, y: number, c: string, s = 1) {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x), Math.round(y), s, s)
}

/* ------------------------------------------------------------------ stars */

const STAR_COLS = [P.slate, P.steel, P.cream, P.white]

/**
 * Two parallax layers of 1px stars (+ a few 4-point sparkles), drifting up
 * with the credits roll (`scroll`, game px).
 */
export function drawStars(ctx: Ctx, gw: number, gh: number, t: number, scroll: number, calm: boolean) {
  const n = Math.round((gw * gh) / 150)
  const step = Math.floor(t * 4)
  for (let i = 0; i < n; i++) {
    const layer = i % 3 === 0 ? 1 : 0
    const par = layer ? 0.45 : 0.18
    const x = Math.floor(hash(i * 3.1) * gw)
    let y = hash(i * 7.7 + 1) * gh - scroll * par
    y = ((y % gh) + gh) % gh
    const tw = calm ? 0.6 : hash2(i, step)
    const lvl = layer ? (tw > 0.85 ? 3 : tw > 0.35 ? 2 : 1) : tw > 0.9 ? 2 : tw > 0.3 ? 1 : 0
    dot(ctx, x, Math.floor(y), STAR_COLS[lvl])
  }
  // a handful of sparkles that twinkle through 3 sprite frames
  const m = Math.max(2, Math.round(n / 40))
  const f = Math.floor(t * 8)
  for (let i = 0; i < m; i++) {
    const x = Math.floor(hash(i * 11.3 + 5) * (gw - 6)) + 3
    let y = hash(i * 5.9 + 9) * gh - scroll * 0.3
    y = Math.floor(((y % gh) + gh) % gh)
    const ph = calm ? 1 : (f + Math.floor(hash(i) * 16)) % 16
    const r = ph < 2 ? 1 : ph < 4 ? 2 : ph < 6 ? 1 : 0
    ctx.fillStyle = r === 2 ? P.white : P.steel
    ctx.fillRect(x, y, 1, 1)
    if (r > 0) {
      ctx.fillRect(x - r, y, r, 1)
      ctx.fillRect(x + 1, y, r, 1)
      ctx.fillRect(x, y - r, 1, r)
      ctx.fillRect(x, y + 1, 1, r)
    }
  }
}

/* ------------------------------------------------------------------ rings & sparkles */

/** a 1px pixel circle (midpoint), every `dash`-th pixel */
export function ring(ctx: Ctx, cx: number, cy: number, r: number, c: string, dash = 1) {
  ctx.fillStyle = c
  let x = Math.round(r)
  let y = 0
  let err = 1 - x
  let k = 0
  cx = Math.round(cx)
  cy = Math.round(cy)
  while (x >= y) {
    if (k++ % dash === 0) {
      ctx.fillRect(cx + x, cy + y, 1, 1)
      ctx.fillRect(cx + y, cy + x, 1, 1)
      ctx.fillRect(cx - y, cy + x, 1, 1)
      ctx.fillRect(cx - x, cy + y, 1, 1)
      ctx.fillRect(cx - x, cy - y, 1, 1)
      ctx.fillRect(cx - y, cy - x, 1, 1)
      ctx.fillRect(cx + y, cy - x, 1, 1)
      ctx.fillRect(cx + x, cy - y, 1, 1)
    }
    y++
    if (err < 0) err += 2 * y + 1
    else {
      x--
      err += 2 * (y - x) + 1
    }
  }
}

/** a radial burst of sparks, `age` seconds after it fired (0.6 s life) */
export function sparkBurst(ctx: Ctx, cx: number, cy: number, age: number, radius: number, cols: string[], seed: number, n = 14) {
  if (age < 0 || age > 0.6) return
  const a = Math.floor(age * 12) / 12
  const k = 1 - Math.exp(-a * 7)
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + hash(seed + i) * 0.4
    const sp = radius * (0.6 + 0.4 * hash(seed * 3 + i))
    const x = cx + Math.cos(ang) * sp * k
    const y = cy + Math.sin(ang) * sp * k + a * a * 20
    const c = cols[Math.min(cols.length - 1, Math.floor((a / 0.6) * cols.length))]
    dot(ctx, x, y, c, a < 0.15 ? 2 : 1)
  }
}

/* ------------------------------------------------------------------ fireworks */

const SHELLS = [
  [P.white, P.gold, P.orange, P.brown],
  [P.white, P.coral, P.magenta, P.purple],
  [P.white, P.cyan, P.blue, P.indigo],
  [P.white, P.signal, P.green, P.pine],
  [P.cream, P.magenta, P.purple, P.indigo],
  [P.white, P.gold, P.coral, P.magenta],
]
const MARK_SHELL = [P.white, P.signal, P.green, P.pine]

let markPts: Float32Array | null = null
function markPoints() {
  markPts ??= logoOutlinePoints(150)
  return markPts
}

const INTERVAL = 0.3
const RISE = 0.45
const LIFE = 1.6

/** a 5px "+" flash */
function flare(ctx: Ctx, x: number, y: number, c: string, r: number) {
  x = Math.round(x)
  y = Math.round(y)
  ctx.fillStyle = c
  ctx.fillRect(x - r, y, r * 2 + 1, 1)
  ctx.fillRect(x, y - r, 1, r * 2 + 1)
  if (r > 1) ctx.fillRect(x - 1, y - 1, 3, 3)
}

/**
 * The credits fireworks show: shells launch on a fixed schedule; `amount`
 * (0..1, scroll-derived) decides which of them fire, so raising it adds
 * shells without moving the ones already in the air. Every 5th shell (once
 * the show is in full swing) bursts into the Hark mark.
 */
export function drawFireworks(ctx: Ctx, box: Box, t: number, amount: number, calm: boolean) {
  if (amount <= 0.001 || box.w < 20 || box.h < 20) return
  const ts = Math.floor(t * 12) / 12
  const fstep = Math.floor(t * 12)
  const span = RISE + LIFE
  const k1 = Math.floor(ts / INTERVAL)
  const k0 = k1 - Math.ceil(span / INTERVAL) - 1
  const size = Math.min(box.w, box.h * 1.25)
  for (let k = k0; k <= k1; k++) {
    if (calm && k % 3) continue
    // small screens get a lighter show, so the credits stay readable
    const gate = hash(k * 1.37 + 0.5)
    if (gate > amount * Math.min(1, 0.35 + box.h / 180)) continue
    const t0 = k * INTERVAL + hash(k * 2.11) * 0.18
    const age = ts - t0
    if (age < 0 || age > span) continue
    const bx = box.x + box.w * (0.12 + 0.76 * hash(k * 3.7))
    const by = box.y + box.h * (0.14 + 0.4 * hash(k * 5.3))
    const isMark = k % 5 === 0 && amount > 0.5 && box.w > 150 && box.h > 90
    const cols = isMark ? MARK_SHELL : SHELLS[Math.floor(hash(k * 9.1) * SHELLS.length)]
    if (age < RISE) {
      // the rocket: a bright head and a short sputtering tail
      const u = age / RISE
      const e = 1 - (1 - u) * (1 - u)
      const sx = bx + (hash(k * 4.4) - 0.5) * 12 * (1 - e)
      const y0 = box.y + box.h + 6
      const sy = y0 + (by - y0) * e
      dot(ctx, sx, sy, P.cream)
      for (let j = 1; j <= 4; j++) {
        if (hash2(k * 7 + j, fstep) < 0.3) continue
        dot(ctx, sx + (hash2(k + j, fstep) - 0.5) * 2, sy + j * 2, j < 2 ? P.gold : j < 4 ? P.orange : P.brown)
      }
      continue
    }
    const a = age - RISE
    const life = a / LIFE
    const radius = (isMark ? 0.62 : 0.3 + 0.2 * hash(k * 6.6)) * size * 0.5
    const expand = 1 - Math.exp(-a * 4.6)
    const fall = a * a * (isMark ? 4 : 10)
    const stage = life < 0.1 ? 0 : life < 0.42 ? 1 : life < 0.72 ? 2 : 3
    const fading = life > 0.6
    // the burst: one frame of flash, then the stars fly
    if (a < 1 / 12) {
      flare(ctx, bx, by, P.white, 2)
      continue
    }
    if (a < 0.17) flare(ctx, bx, by, cols[1], 1)
    if (isMark) {
      const pts = markPoints()
      const n = pts.length / 3
      for (let i = 0; i < n; i++) {
        if (fading && hash2(k * 31 + i, fstep) < (life - 0.6) * 2.2) continue
        const x = bx + pts[i * 3] * radius * 2 * expand
        const y = by - pts[i * 3 + 1] * radius * 2 * expand + fall
        dot(ctx, x, y, cols[stage], stage === 1 ? 2 : 1)
      }
      continue
    }
    const n = 34 + Math.floor(hash(k * 8.8) * 18)
    const ringy = hash(k * 12.1) < 0.35
    const two = hash(k * 13.7) < 0.4
    for (let i = 0; i < n; i++) {
      if (fading && hash2(k * 17 + i, fstep) < (life - 0.6) * 2.4) continue
      const ang = (i / n) * Math.PI * 2 + hash(k + i * 0.7) * (ringy ? 0.04 : 0.45)
      const sp = ringy ? 1 : 0.4 + 0.6 * hash(k * 2.9 + i)
      const r = radius * sp * expand
      const x = bx + Math.cos(ang) * r
      const y = by + Math.sin(ang) * r + fall
      // trails back toward the centre while the stars are still flying
      if (life < 0.5) {
        for (let j = 1; j <= 2; j++) {
          const rt = radius * sp * (1 - Math.exp(-Math.max(0, a - j / 12) * 4.6))
          dot(ctx, bx + Math.cos(ang) * rt, by + Math.sin(ang) * rt + fall * (1 - j * 0.08), cols[Math.min(3, stage + j)])
        }
      }
      // two-colour shells: every other star in the secondary colour
      const c = two && i % 2 && stage > 0 ? cols[Math.min(3, stage + 1)] : cols[stage]
      dot(ctx, x, y, c, stage === 1 ? 2 : 1)
    }
  }
}
