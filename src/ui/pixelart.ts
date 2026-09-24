import { MARK_PATHS, MARK_VIEWBOX, markSvg } from './mark'

/*
 * Pixel art for the DOM layer (chrome, loader, pause menu, rotate card,
 * instruction booklet). Everything is drawn on a whole-pixel grid and emitted
 * as inline SVG with crispEdges, so it scales to any integer size without a
 * single soft edge, in every browser, with no image files.
 *
 *   pixelSvg(rows, map)   ASCII art -> SVG (one merged path per colour)
 *   pixelMark(n, opts)    the Hark mark rasterised onto an n x n grid, with a
 *                         1px ink outline and optional 16-bit bevel shading
 *   ICON                  the little sprites the UI uses (speaker, heart,
 *                         cursor, coin, phone, star)
 *
 * All output is decorative (aria-hidden, focusable=false).
 */

/** Hark-16 colours used by the DOM layer (mirrors PALETTE_HEX in src/core/post.ts). */
export const C = {
  void: '#0b0d14',
  night: '#1b1f3b',
  indigo: '#2c2f6b',
  purple: '#5a3a9a',
  magenta: '#c2419a',
  coral: '#ff5a6e',
  orange: '#ff9b3d',
  gold: '#ffd84a',
  cream: '#fff4d8',
  white: '#ffffff',
  steel: '#9aa3c7',
  slate: '#4e557e',
  signal: '#00ff85',
  green: '#00b862',
  pine: '#0e6b52',
  cyan: '#2fd4e0',
  blue: '#3a7bff',
  brown: '#8b5a3c',
}

/**
 * Pixel grid (rows of chars) -> merged horizontal runs per character.
 * '.' and ' ' are empty.
 */
function runs(rows: string[]) {
  const byChar = new Map<string, string[]>()
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.' || ch === ' ') {
        x++
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      let list = byChar.get(ch)
      if (!list) byChar.set(ch, (list = []))
      list.push(`M${x} ${y}h${end - x}v1h${x - end}z`)
      x = end
    }
  })
  return byChar
}

/**
 * ASCII art -> inline SVG. `map` gives each character a fill (a colour) and
 * optionally a class (`'a': ['#fff', 'wave-a']`) so CSS can animate parts.
 */
export function pixelSvg(rows: string[], map: Record<string, string | [string, string]>, cls = '') {
  const w = Math.max(...rows.map(r => r.length))
  const h = rows.length
  const paths: string[] = []
  for (const [ch, d] of runs(rows)) {
    const m = map[ch]
    if (!m) continue
    const [fill, pc] = Array.isArray(m) ? m : [m, '']
    paths.push(`<path${pc ? ` class="${pc}"` : ''} fill="${fill}" d="${d.join('')}"/>`)
  }
  return `<svg class="px ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${paths.join('')}</svg>`
}

/* ------------------------------------------------------------------ the mark */

interface MarkOpts {
  /** loops colour */
  loop?: string
  /** diamond colour */
  diamond?: string
  /** outline colour ('' for none) */
  outline?: string
  /** 16-bit bevel: a highlight on top-left edges and a shade on bottom-right */
  shade?: boolean
  /** bevel colours: [loop highlight, loop shade, diamond highlight, diamond shade] */
  bevel?: [string, string, string, string]
  cls?: string
}

/** the arcade title-screen colourway: signal-green loops, a gold diamond (as in the 3D hero) */
export const MARK_TITLE: MarkOpts = {
  loop: C.signal,
  diamond: C.gold,
  shade: true,
  bevel: ['#b8ffd9', C.green, C.white, C.orange],
}

const gridCache = new Map<number, string[] | null>()

/**
 * The Hark mark on an n x n pixel grid (1px of the grid is kept free on each
 * side for the outline). Codes: L loop, D diamond, O outline, plus bevels
 * H/S (loop highlight/shade) and h/s (diamond highlight/shade).
 */
function markGrid(n: number): string[] | null {
  if (gridCache.has(n)) return gridCache.get(n)!
  let rows: string[] | null = null
  try {
    const c = document.createElement('canvas')
    c.width = c.height = n
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx || typeof Path2D === 'undefined') throw new Error('no canvas')
    const vb = MARK_VIEWBOX.split(/\s+/).map(Number)
    const inner = n - 2
    const s = inner / Math.max(vb[2], vb[3])
    const sample = (paths: string[]) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, n, n)
      ctx.setTransform(s, 0, 0, s, 1, 1)
      ctx.fillStyle = '#fff'
      for (const d of paths) ctx.fill(new Path2D(d))
      return ctx.getImageData(0, 0, n, n).data
    }
    const loops = sample(MARK_PATHS.loops)
    const dia = sample([MARK_PATHS.diamond])
    const g: string[][] = []
    for (let y = 0; y < n; y++) {
      const row: string[] = []
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4 + 3
        row.push(dia[i] >= 120 ? 'D' : loops[i] >= 118 ? 'L' : '.')
      }
      g.push(row)
    }
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? '.' : g[y][x])
    const filled = (ch: string) => ch === 'L' || ch === 'D'
    // small grids: the diamond would shrink to a dot, so grow it by a pixel
    // into the empty space around it (a pixel artist's exaggeration)
    if (n < 28) {
      const grow: [number, number][] = []
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          if (g[y][x] === '.' && [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].includes('D')) grow.push([x, y])
      for (const [x, y] of grow) g[y][x] = 'D'
    }
    // bevel first (reads the un-outlined grid)
    const bevel = g.map((row, y) =>
      row.map((ch, x) => {
        if (!filled(ch)) return ch
        const lit = !filled(at(x, y - 1)) || !filled(at(x - 1, y))
        const dark = !filled(at(x, y + 1)) || !filled(at(x + 1, y))
        if (lit && !dark) return ch === 'L' ? 'H' : 'h'
        if (dark && !lit) return ch === 'L' ? 'S' : 's'
        return ch
      }),
    )
    // outline: every empty pixel touching the mark (8-neighbourhood)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (filled(g[y][x])) continue
        let touch = false
        for (let dy = -1; dy <= 1 && !touch; dy++)
          for (let dx = -1; dx <= 1 && !touch; dx++) if (filled(at(x + dx, y + dy))) touch = true
        if (touch) bevel[y][x] = 'O'
      }
    rows = bevel.map(r => r.join(''))
  } catch {
    rows = null
  }
  gridCache.set(n, rows)
  return rows
}

/**
 * The Hark mark as crisp pixel art (n x n grid). Falls back to the vector
 * mark where a 2D canvas is unavailable.
 */
export function pixelMark(n: number, o: MarkOpts = {}) {
  const rows = markGrid(n)
  const cls = `px-mark ${o.cls ?? ''}`
  if (!rows) return markSvg(cls)
  const loop = o.loop ?? C.cream
  const diamond = o.diamond ?? C.signal
  const flat = !o.shade
  const [lh, ls, dh, ds] = o.bevel ?? [C.white, C.steel, '#9bffcf', C.green]
  const map: Record<string, string> = {
    L: loop,
    D: diamond,
    H: flat ? loop : lh,
    S: flat ? loop : ls,
    h: flat ? diamond : dh,
    s: flat ? diamond : ds,
  }
  if (o.outline !== '') map.O = o.outline ?? C.void
  return pixelSvg(rows, map, cls)
}

/* ------------------------------------------------------------------ sprites */

const SPEAKER = [
  '.....#.......',
  '....##.....b.',
  '...###..a...b',
  '######...a..b',
  '######...a..b',
  '######...a..b',
  '...###..a...b',
  '....##.....b.',
  '.....#.......',
]
const SPEAKER_X = [
  '.....#.......',
  '....##.......',
  '...###..x...x',
  '######...x.x.',
  '######....x..',
  '######...x.x.',
  '...###..x...x',
  '....##.......',
  '.....#.......',
]

/** speaker with both states in one sprite: .spk-a/.spk-b waves (on) and .spk-x (off) */
function speaker() {
  const on = runs(SPEAKER)
  const off = runs(SPEAKER_X)
  const d = (m: Map<string, string[]>, k: string) => (m.get(k) ?? []).join('')
  return `<svg class="px px-spk" viewBox="0 0 13 9" width="13" height="9" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path class="spk-body" d="${d(on, '#')}"/><path class="spk-a" d="${d(on, 'a')}"/><path class="spk-b" d="${d(on, 'b')}"/><path class="spk-x" d="${d(off, 'x')}"/></svg>`
}

export const ICON = {
  speaker,
  heart: (cls = '') =>
    pixelSvg(
      ['.##.##.', '#w#####', '#######', '.#####.', '..###..', '...#...'],
      { '#': C.coral, w: C.cream },
      `px-heart ${cls}`,
    ),
  cursor: (cls = '') => pixelSvg(['#...', '##..', '###.', '####', '###.', '##..', '#...'], { '#': 'currentColor' }, `px-cur ${cls}`),
  coin: (cls = '') =>
    pixelSvg(
      ['..####..', '.#gggg#.', '#gwggGg#', '#gwggGg#', '#gwggGg#', '#gwggGg#', '.#gggg#.', '..####..'],
      { '#': C.void, g: C.gold, w: C.cream, G: C.orange },
      `px-coin ${cls}`,
    ),
  star: (cls = '') =>
    pixelSvg(['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'], { '#': 'currentColor' }, `px-star ${cls}`),
  /** a phone in portrait: the rotate card turns it upright in 90 degree steps */
  phone: (cls = '') =>
    pixelSvg(
      [
        '.#########.',
        '#ccccccccc#',
        '#csssssssc#',
        '#csssssssc#',
        '#csssdsssc#',
        '#cssdddssc#',
        '#csddgddsc#',
        '#cssdddssc#',
        '#csssdsssc#',
        '#csssssssc#',
        '#csssssssc#',
        '#csssssssc#',
        '#ccccccccc#',
        '#cccc#cccc#',
        '.#########.',
      ],
      { '#': C.void, c: C.cream, s: C.indigo, d: C.signal, g: C.cream },
      `px-phone ${cls}`,
    ),
}
