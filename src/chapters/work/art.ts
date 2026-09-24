import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { rng } from '../../core/math'
import { logoOutlines } from '../../logo/logo'

/*
 * Arcade Hall pixel art, painted on small canvases at 1 texel = 1 game pixel
 * and nearest-filtered, so after the CRT pass it reads as hand-placed sprites:
 * attract-mode title cards, cabinet marquees, the cosmic carpet, the
 * Philadelphia skyline outside the windows and the neon signs.
 */

export const FONT_DISPLAY = "'Hark Pixel', monospace"
export const FONT_MONO = "'Silkscreen', monospace"

/** Cabinet colour schemes (side art, stripes, trim, marquee bands, attract screen). */
export interface Theme {
  side: string
  s1: string
  s2: string
  trim: string
  /** marquee backlight bands, top to bottom */
  bands: string[]
  /** attract screen background + accent */
  bg: string
  accent: string
  /** marquee name fill + shadow */
  ink: string
  shadow: string
}

export const THEMES: Theme[] = [
  { side: P.indigo, s1: P.cyan, s2: P.blue, trim: P.cyan, bands: [P.night, P.indigo, P.blue, P.cyan], bg: P.night, accent: P.cyan, ink: P.cream, shadow: P.void },
  { side: P.purple, s1: P.magenta, s2: P.coral, trim: P.coral, bands: [P.night, P.purple, P.magenta, P.coral], bg: P.night, accent: P.coral, ink: P.cream, shadow: P.void },
  { side: P.pine, s1: P.signal, s2: P.gold, trim: P.signal, bands: [P.void, P.pine, P.green, P.signal], bg: P.void, accent: P.signal, ink: P.cream, shadow: P.void },
  { side: P.blue, s1: P.gold, s2: P.orange, trim: P.gold, bands: [P.night, P.blue, P.orange, P.gold], bg: P.night, accent: P.gold, ink: P.void, shadow: P.cream },
  { side: P.magenta, s1: P.gold, s2: P.cream, trim: P.gold, bands: [P.purple, P.magenta, P.coral, P.orange], bg: P.night, accent: P.gold, ink: P.cream, shadow: P.void },
  { side: P.coral, s1: P.purple, s2: P.gold, trim: P.orange, bands: [P.night, P.coral, P.orange, P.gold], bg: P.night, accent: P.orange, ink: P.void, shadow: P.cream },
  // the house machine: the high-score cabinet
  { side: P.night, s1: P.signal, s2: P.gold, trim: P.signal, bands: [P.void, P.night, P.pine, P.green], bg: P.void, accent: P.signal, ink: P.gold, shadow: P.void },
]

export function canvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  g.imageSmoothingEnabled = false
  return { cv, g }
}

export function canvasTex(cv: HTMLCanvasElement, o: { repeat?: boolean; mip?: boolean } = {}) {
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  t.minFilter = o.mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter
  t.generateMipmaps = !!o.mip
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Largest font size (<= max) at which every line fits `width`. */
function fit(g: CanvasRenderingContext2D, lines: string[], family: string, weight: number, max: number, min: number, width: number) {
  let px = max
  for (; px > min; px--) {
    g.font = `${weight} ${px}px ${family}`
    if (lines.every(l => g.measureText(l).width <= width)) break
  }
  g.font = `${weight} ${px}px ${family}`
  return px
}

/** Split a name into one or two balanced lines. */
function split(name: string, g: CanvasRenderingContext2D, width: number): string[] {
  if (g.measureText(name).width <= width || !name.includes(' ')) return [name]
  const words = name.split(' ')
  let best: string[] = [name]
  let score = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const s = Math.max(g.measureText(a).width, g.measureText(b).width)
    if (s < score) {
      score = s
      best = [a, b]
    }
  }
  return best
}

/** Hard pixel text: outline + drop shadow + fill. */
function pixelWords(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, shadow: string, sh = 2) {
  g.fillStyle = shadow
  g.fillText(text, x + sh, y + sh)
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])
    g.fillText(text, x + dx, y + dy)
  g.fillStyle = fill
  g.fillText(text, x, y)
}

// ------------------------------------------------------------------ attract screens

export const ATTRACT = { w: 192, h: 120, cols: 2, rows: 4 }

/**
 * Attract-mode title cards, one per cabinet, in a 2x4 atlas. The INSERT COIN
 * line sits in uv.y 0.07..0.2 of its cell; the screen shader blinks it.
 */
export function drawAttract(names: string[]) {
  const { w, h, cols, rows } = ATTRACT
  const { cv, g } = canvas(w * cols, h * rows)
  const paint = () => {
    g.clearRect(0, 0, cv.width, cv.height)
    names.forEach((name, i) => {
      const t = THEMES[i]
      const ox = (i % cols) * w
      const oy = Math.floor(i / cols) * h
      g.save()
      g.translate(ox, oy)
      g.beginPath()
      g.rect(0, 0, w, h)
      g.clip()
      g.fillStyle = t.bg
      g.fillRect(0, 0, w, h)
      // pixel starfield
      const r = rng(31 + i * 7)
      for (let s = 0; s < 34; s++) {
        g.fillStyle = r() < 0.3 ? t.accent : r() < 0.5 ? P.steel : P.slate
        g.fillRect(Math.floor(r() * w), Math.floor(r() * (h - 24)) + 12, 1, 1)
      }
      // ground stripes (perspective floor of a racing/shooting game)
      for (let k = 0; k < 5; k++) {
        const y = 78 + k * k * 1.2 + k * 2
        g.fillStyle = k % 2 ? t.accent : P.indigo
        g.fillRect(0, Math.round(y), w, 1)
      }
      // header
      g.font = `400 8px ${FONT_MONO}`
      g.textBaseline = 'top'
      g.fillStyle = P.steel
      g.fillText(`CAB ${String(i + 1).padStart(2, '0')}`, 6, 5)
      g.fillStyle = t.accent
      const hi = i === names.length - 1 ? 'HARK' : '1UP'
      g.fillText(hi, w - 6 - g.measureText(hi).width, 5)
      // title
      g.font = `700 22px ${FONT_DISPLAY}`
      const lines = split(name.toUpperCase(), g, w - 20)
      const px = fit(g, lines, FONT_DISPLAY, 700, lines.length > 1 ? 20 : 24, 10, w - 20)
      g.textBaseline = 'middle'
      const lh = px * 1.05
      const y0 = 46 - ((lines.length - 1) * lh) / 2
      lines.forEach((line, k) => {
        const lw = g.measureText(line).width
        pixelWords(g, line, Math.round((w - lw) / 2), Math.round(y0 + k * lh), P.gold, P.magenta, 2)
      })
      // insert coin
      g.font = `400 8px ${FONT_MONO}`
      g.textBaseline = 'top'
      const ic = i === names.length - 1 ? 'HIGH SCORES' : 'INSERT COIN'
      const iw = g.measureText(ic).width
      g.fillStyle = P.void
      g.fillRect(Math.round((w - iw) / 2) - 3, 98, Math.ceil(iw) + 6, 12)
      g.fillStyle = P.cream
      g.fillText(ic, Math.round((w - iw) / 2), 100)
      // frame
      g.strokeStyle = t.accent
      g.lineWidth = 2
      g.strokeRect(1, 1, w - 2, h - 2)
      g.restore()
    })
  }
  paint()
  const tex = canvasTex(cv)
  return { tex, paint }
}

/** uv offset/scale of attract cell i (for a shader uniform vec4). */
export function attractCell(i: number) {
  const { cols, rows } = ATTRACT
  const cx = i % cols
  const cy = Math.floor(i / cols)
  // canvas rows go down; with flipY the texture v goes up
  return new THREE.Vector4(cx / cols, 1 - (cy + 1) / rows, 1 / cols, 1 / rows)
}

// ------------------------------------------------------------------ marquees

export const MARQUEE = { w: 256, h: 82, cols: 2, rows: 4 }

export function drawMarquees(names: string[]) {
  const { w, h, cols, rows } = MARQUEE
  const { cv, g } = canvas(w * cols, h * rows)
  const paint = () => {
    g.clearRect(0, 0, cv.width, cv.height)
    names.forEach((name, i) => {
      const t = THEMES[i]
      const ox = (i % cols) * w
      const oy = Math.floor(i / cols) * h
      g.save()
      g.translate(ox, oy)
      // stepped sunset bands
      const bands = t.bands
      const bh = [0.34, 0.26, 0.22, 0.18]
      let y = 0
      bands.forEach((c, k) => {
        const hh = Math.round(bh[k] * h)
        g.fillStyle = c
        g.fillRect(0, y, w, hh + 1)
        y += hh
      })
      // dithered seams between bands
      y = 0
      for (let k = 0; k < bands.length - 1; k++) {
        y += Math.round(bh[k] * h)
        g.fillStyle = bands[k + 1]
        for (let x = 0; x < w; x += 2) g.fillRect(x + ((y / 1) % 2), y - 2, 1, 1)
        g.fillStyle = bands[k]
        for (let x = 1; x < w; x += 2) g.fillRect(x, y + 1, 1, 1)
      }
      // speed lines
      g.fillStyle = P.cream
      const r = rng(97 + i * 13)
      for (let s = 0; s < 9; s++) {
        const ly = 14 + Math.floor(r() * (h - 30))
        const lx = Math.floor(r() * w)
        g.globalAlpha = 0.35
        g.fillRect(lx, ly, 10 + Math.floor(r() * 26), 1)
      }
      g.globalAlpha = 1
      // sparkles
      for (let s = 0; s < 5; s++) {
        const sx = 12 + Math.floor(r() * (w - 24))
        const sy = 12 + Math.floor(r() * (h - 24))
        g.fillStyle = P.white
        g.fillRect(sx, sy - 2, 1, 5)
        g.fillRect(sx - 2, sy, 5, 1)
      }
      // name
      g.font = `700 40px ${FONT_DISPLAY}`
      const upper = name.toUpperCase()
      const lines = split(upper, g, w - 34)
      const px = fit(g, lines, FONT_DISPLAY, 700, lines.length > 1 ? 27 : 38, 12, w - 34)
      g.textBaseline = 'middle'
      const lh = px * 0.98
      const y0 = h / 2 - ((lines.length - 1) * lh) / 2 + 1
      lines.forEach((line, k) => {
        const lw = g.measureText(line).width
        pixelWords(g, line, Math.round((w - lw) / 2), Math.round(y0 + k * lh), t.ink, t.shadow, 3)
      })
      // frame (the chase bulbs sit on it)
      g.fillStyle = P.void
      g.fillRect(0, 0, w, 7)
      g.fillRect(0, h - 7, w, 7)
      g.fillRect(0, 0, 6, h)
      g.fillRect(w - 6, 0, 6, h)
      g.fillStyle = t.trim
      g.fillRect(0, 7, w, 1)
      g.fillRect(0, h - 8, w, 1)
      g.restore()
    })
  }
  paint()
  return { tex: canvasTex(cv), paint }
}

/** uv rect of marquee i: [u0, v0, u1, v1] */
export function marqueeUv(i: number): [number, number, number, number] {
  const { cols, rows } = MARQUEE
  const cx = i % cols
  const cy = Math.floor(i / cols)
  return [cx / cols, 1 - (cy + 1) / rows, (cx + 1) / cols, 1 - cy / rows]
}

// ------------------------------------------------------------------ carpet

/** Cosmic arcade carpet: neon squiggles, rings and triangles on night blue. Tiles seamlessly. */
export function drawCarpet() {
  const S = 96
  const { cv, g } = canvas(S, S)
  g.fillStyle = P.night
  g.fillRect(0, 0, S, S)
  const r = rng(2024)
  const cols = [P.magenta, P.cyan, P.gold, P.purple, P.coral, P.blue]
  const put = (fn: (x: number, y: number) => void, x: number, y: number) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(x + dx, y + dy)
  }
  // faint dot grid
  g.fillStyle = P.indigo
  for (let y = 0; y < S; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < S; x += 8) g.fillRect(x, y, 1, 1)
  const cell = 24
  for (let gy = 0; gy < S / cell; gy++) {
    for (let gx = 0; gx < S / cell; gx++) {
      const x = gx * cell + Math.floor(r() * 12)
      const y = gy * cell + Math.floor(r() * 12)
      const c = cols[Math.floor(r() * cols.length)]
      const kind = Math.floor(r() * 5)
      g.fillStyle = c
      if (kind === 0) {
        // zig-zag squiggle
        put((px, py) => {
          for (let i = 0; i < 12; i++) g.fillRect(px + i, py + (Math.floor(i / 3) % 2 ? 2 : 0) + (i % 3 === 1 ? 1 : 0), 1, 2)
        }, x, y)
      } else if (kind === 1) {
        // ring
        put((px, py) => {
          g.fillRect(px + 2, py, 4, 1)
          g.fillRect(px + 2, py + 7, 4, 1)
          g.fillRect(px, py + 2, 1, 4)
          g.fillRect(px + 7, py + 2, 1, 4)
          g.fillRect(px + 1, py + 1, 1, 1)
          g.fillRect(px + 6, py + 1, 1, 1)
          g.fillRect(px + 1, py + 6, 1, 1)
          g.fillRect(px + 6, py + 6, 1, 1)
        }, x, y)
      } else if (kind === 2) {
        // triangle
        put((px, py) => {
          for (let i = 0; i < 6; i++) g.fillRect(px + 5 - i, py + i, 1 + i * 2 > 11 ? 11 : 1 + i * 2, 1)
        }, x, y)
      } else if (kind === 3) {
        // plus / star
        put((px, py) => {
          g.fillRect(px + 3, py, 1, 7)
          g.fillRect(px, py + 3, 7, 1)
        }, x, y)
      } else {
        // dot pair
        put((px, py) => {
          g.fillRect(px, py, 2, 2)
          g.fillRect(px + 5, py + 4, 2, 2)
        }, x, y)
      }
    }
  }
  return canvasTex(cv, { repeat: true, mip: true })
}

// ------------------------------------------------------------------ skyline

/** Night skyline strip (Philadelphia-ish landmarks), bottom-aligned, transparent sky. */
export function drawSkyline(far: boolean) {
  const W = 512
  const H = far ? 128 : 96
  const { cv, g } = canvas(W, H)
  const r = rng(far ? 88 : 41)
  const body = far ? P.indigo : P.night
  const roof = far ? P.purple : P.indigo
  const lit = far ? [P.gold, P.cream, P.orange] : [P.gold, P.orange]
  const building = (x: number, bw: number, bh: number, windows = true) => {
    const y = H - bh
    g.fillStyle = body
    g.fillRect(x, y, bw, bh)
    g.fillStyle = roof
    g.fillRect(x, y, bw, 1)
    if (!windows) return
    for (let wy = y + 3; wy < H - 2; wy += 3) {
      for (let wx = x + 2; wx < x + bw - 1; wx += 3) {
        if (r() < (far ? 0.2 : 0.12)) {
          g.fillStyle = lit[Math.floor(r() * lit.length)]
          g.fillRect(wx, wy, 1, 1)
        }
      }
    }
  }
  let x = 0
  while (x < W) {
    const bw = 8 + Math.floor(r() * (far ? 22 : 30))
    const bh = (far ? 22 : 14) + Math.floor(r() * (far ? 60 : 40))
    building(x, bw, bh)
    if (!far && r() < 0.35) {
      // rooftop water tower
      const tx = x + 2 + Math.floor(r() * Math.max(1, bw - 8))
      const ty = H - bh
      g.fillStyle = body
      g.fillRect(tx, ty - 6, 5, 4)
      g.fillRect(tx + 1, ty - 7, 3, 1)
      g.fillRect(tx, ty - 2, 1, 2)
      g.fillRect(tx + 4, ty - 2, 1, 2)
    }
    x += bw + (r() < 0.3 ? 2 : 0)
  }
  if (far) {
    // City Hall: base block, tower, clock, statue on top
    const cx = 150
    g.fillStyle = body
    g.fillRect(cx - 16, H - 40, 32, 40)
    g.fillRect(cx - 6, H - 84, 12, 44)
    g.fillRect(cx - 4, H - 96, 8, 12)
    g.fillRect(cx - 2, H - 104, 4, 8)
    g.fillRect(cx - 1, H - 110, 2, 6)
    g.fillStyle = P.gold
    g.fillRect(cx - 3, H - 78, 6, 5)
    g.fillStyle = body
    g.fillRect(cx - 1, H - 77, 2, 2)
    // One Liberty Place: stepped spire
    const lx = 300
    building(lx - 9, 18, 100)
    g.fillStyle = body
    g.fillRect(lx - 6, H - 106, 12, 6)
    g.fillRect(lx - 4, H - 112, 8, 6)
    g.fillRect(lx - 2, H - 118, 4, 6)
    g.fillRect(lx, H - 127, 1, 9)
    g.fillStyle = P.cyan
    g.fillRect(lx - 6, H - 101, 12, 1)
    // a tall glass slab
    const sx = 392
    building(sx - 10, 20, 116)
    g.fillStyle = P.blue
    g.fillRect(sx - 10, H - 116, 20, 2)
  }
  return canvasTex(cv)
}

// ------------------------------------------------------------------ neon signs

/** Neon text: a coloured tube stroke with a pale hot core. */
export function drawNeonText(text: string, tube: string, px = 26) {
  const probe = canvas(4, 4).g
  probe.font = `700 ${px}px ${FONT_DISPLAY}`
  const tw = Math.ceil(probe.measureText(text).width)
  const pad = 6
  const { cv, g } = canvas(tw + pad * 2, Math.ceil(px * 1.4) + pad)
  const paint = () => {
    g.clearRect(0, 0, cv.width, cv.height)
    g.font = `700 ${px}px ${FONT_DISPLAY}`
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    // a faint baked halo, then the tube itself in its own colour
    g.globalAlpha = 0.28
    g.strokeStyle = tube
    g.lineWidth = 6
    g.strokeText(text, pad, cv.height / 2)
    g.globalAlpha = 1
    g.fillStyle = tube
    g.fillText(text, pad, cv.height / 2)
  }
  paint()
  return { tex: canvasTex(cv), paint, aspect: cv.width / cv.height }
}

/** The Hark mark as a neon tube outline. */
export function drawNeonMark(tube: string) {
  const S = 96
  const { cv, g } = canvas(S, S)
  const outlines = logoOutlines(undefined, 90)
  const toPx = (v: THREE.Vector2) => [S / 2 + v.x * S * 0.8, S / 2 - v.y * S * 0.8] as const
  g.lineJoin = 'round'
  for (const [w, c, al] of [
    [6, tube, 0.28],
    [3, tube, 1],
  ] as const) {
    g.globalAlpha = al
    g.strokeStyle = c
    g.lineWidth = w
    for (const line of outlines) {
      g.beginPath()
      line.forEach((p, i) => {
        const [x, y] = toPx(p)
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      })
      g.closePath()
      g.stroke()
    }
  }
  g.globalAlpha = 1
  return canvasTex(cv)
}

/** Soft radial spot (for floor light pools); white, alpha falls off. */
export function drawRadial() {
  const S = 64
  const { cv, g } = canvas(S, S)
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Resolve once the pixel fonts are in (or after a timeout). */
export function fontsReady(): Promise<void> {
  const f = document.fonts
  if (!f?.load) return Promise.resolve()
  const loads = Promise.all([f.load(`700 20px ${FONT_DISPLAY}`), f.load(`400 8px ${FONT_MONO}`)]).then(() => undefined)
  return Promise.race([loads, new Promise<void>(r => setTimeout(r, 4000))]).catch(() => undefined)
}
