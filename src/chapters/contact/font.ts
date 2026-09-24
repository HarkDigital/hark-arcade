/*
 * A hand-drawn 5x7 arcade bitmap font (plus a few wider symbols) rendered at
 * the CRT's own game resolution, so every glyph pixel lands on exactly one
 * game pixel: the credits, "CONTINUE?" and "THANKS FOR PLAYING" read like a
 * real 16-bit ROM font, not a web font run through a filter.
 *
 *   lineCanvas(text, style)  -> cached canvas of one line (banded fill,
 *                               1px outline, hard drop shadow)
 *   textWidth(text, scale)   -> advance width in game px (no outline)
 *   wrap(text, maxW, scale)  -> greedy wrap, breaking at " · " first
 */

const G: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '·': ['..', '..', '..', '##', '##', '..', '..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '©': ['.#####.', '#.....#', '#..##.#', '#.#...#', '#..##.#', '#.....#', '.#####.'],
  '↗': ['.....', '.####', '...##', '..#.#', '.#..#', '#....', '.....'],
  '▶': ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
  '◀': ['...#', '..##', '.###', '####', '.###', '..##', '...#'],
  '▼': ['.......', '#######', '.#####.', '..###..', '...#...', '.......', '.......'],
  '♥': ['.......', '.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  '★': ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
}
const SPACE = 3
const H = 7

/** advance width of one glyph (without the 1px spacing) */
const gw = (ch: string) => (ch === ' ' ? SPACE : (G[ch]?.[0].length ?? 5))

const norm = (s: string) => s.toUpperCase().replace(/[×]/g, 'X')

/** width in game px at a scale (glyph spacing included, no outline/shadow) */
export function textWidth(text: string, scale = 1) {
  const t = norm(text)
  let w = 0
  for (let i = 0; i < t.length; i++) w += gw(t[i]) + (i < t.length - 1 ? 1 : 0)
  return w * scale
}

export const lineHeight = (scale = 1) => H * scale

/** greedy word wrap of one run of words */
function wrapWords(text: string, maxW: number, scale: number) {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w
    if (!cur || textWidth(next, scale) <= maxW) cur = next
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/**
 * Greedy wrap that prefers the " · " separators as break points (so
 * "EST. 2016" never splits), falling back to word breaks inside a segment
 * that is too wide on its own. A separator never starts or ends a line.
 */
export function wrap(text: string, maxW: number, scale = 1): string[] {
  const segs = norm(text).split(' · ')
  const lines: string[] = []
  let cur = ''
  for (const seg of segs) {
    const next = cur ? `${cur} · ${seg}` : seg
    if (textWidth(next, scale) <= maxW) {
      cur = next
      continue
    }
    if (cur) lines.push(cur)
    if (textWidth(seg, scale) <= maxW) cur = seg
    else {
      const parts = wrapWords(seg, maxW, scale)
      cur = parts.pop() ?? ''
      lines.push(...parts)
    }
  }
  if (cur) lines.push(cur)
  return lines.filter(Boolean)
}

export interface TextStyle {
  scale: number
  /** fill colours, top to bottom (spread over the glyph height) */
  bands: string[]
  /** 1px outline colour */
  outline?: string
  /** hard drop shadow colour (offset = max(1, scale/2) px down-right, under the outline) */
  shadow?: string
}

const cache = new Map<string, HTMLCanvasElement>()

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** extra px the outline/shadow add around the text box */
export function stylePad(style: TextStyle) {
  const o = style.outline ? 1 : 0
  const sh = style.shadow ? Math.max(1, Math.round(style.scale / 2)) : 0
  return { o, sh }
}

/** One line of text as a small canvas (cached). Draw it at integer coords. */
export function lineCanvas(text: string, style: TextStyle): HTMLCanvasElement {
  const t = norm(text)
  const key = `${t}|${style.scale}|${style.bands.join(',')}|${style.outline ?? ''}|${style.shadow ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = style.scale
  const w0 = Math.max(1, textWidth(t, s))
  const h0 = H * s
  const mask = new Uint8Array(w0 * h0)
  let x = 0
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    const rows = G[ch]
    const cw = gw(ch)
    if (rows) {
      for (let gy = 0; gy < H; gy++) {
        const row = rows[gy]
        for (let gx = 0; gx < row.length; gx++) {
          if (row[gx] !== '#') continue
          for (let yy = 0; yy < s; yy++)
            for (let xx = 0; xx < s; xx++) mask[(gy * s + yy) * w0 + (x + gx) * s + xx] = 1
        }
      }
    }
    x += cw + 1
  }
  const { o, sh } = stylePad(style)
  const W = w0 + o * 2 + sh
  const Hh = h0 + o * 2 + sh
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = Hh
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(W, Hh)
  const d = img.data
  const put = (px: number, py: number, c: [number, number, number]) => {
    if (px < 0 || py < 0 || px >= W || py >= Hh) return
    const i = (py * W + px) * 4
    d[i] = c[0]
    d[i + 1] = c[1]
    d[i + 2] = c[2]
    d[i + 3] = 255
  }
  const on = (mx: number, my: number) => mx >= 0 && my >= 0 && mx < w0 && my < h0 && mask[my * w0 + mx] === 1
  // outlined silhouette (mask dilated by the outline)
  const sil = (mx: number, my: number) => {
    if (!o) return on(mx, my)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (on(mx + dx, my + dy)) return true
    return false
  }
  if (style.shadow) {
    const c = rgb(style.shadow)
    for (let py = 0; py < Hh; py++)
      for (let px = 0; px < W; px++) if (sil(px - o - sh, py - o - sh)) put(px, py, c)
  }
  if (style.outline) {
    const c = rgb(style.outline)
    for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) if (sil(px - o, py - o)) put(px, py, c)
  }
  const bands = style.bands.map(rgb)
  for (let my = 0; my < h0; my++) {
    const c = bands[Math.min(bands.length - 1, Math.floor((my / h0) * bands.length))]
    for (let mx = 0; mx < w0; mx++) if (mask[my * w0 + mx]) put(mx + o, my + o, c)
  }
  ctx.putImageData(img, 0, 0)
  cache.set(key, cv)
  return cv
}
