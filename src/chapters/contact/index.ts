import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { setRise } from '../../core/dom'
import { clamp, lerp, segment } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { BRAND, MICROCOPY } from '../../content'
import { P } from '../../kit/pixel'
import { PixelLayer } from './layer'
import { lineCanvas, lineHeight, textWidth, wrap, type TextStyle } from './font'
import { buildCoin, buildDigits, buildDoor, buildMark, COIN_W, DIGIT_H, DOOR_H, SLOT_DY, type Door, type Mark } from './models'
import { drawFireworks, drawStars, ring, sparkBurst } from './fx'
import { buildHud, measureHud, type Hud, type HudLayout } from './hud'
import './contact.css'

/*
 * LEVEL 7 · CONTINUE? — the final level (1.6 vh, nav lands at 0.3).
 *
 *   0.00–0.04  the iris opens on a black screen: "CONTINUE?" types in, the
 *              Hark mark sits greyed out (the player is down)
 *   0.035–0.23 the countdown slams in: 9 · 8 · 7 · 6 · 5 · 4, the mark's
 *              heartbeat pulsing behind it
 *   0.227      …and never reaches zero: the digit flips away, the mark lights
 *              up signal green (the friendly frame)
 *   0.245      the game window opens (stepped, like an RPG box): "Say hello."
 *              The screen slides beside it; INSERT COIN now points at the
 *              email button, and the coin door's slot glows. Hover the button
 *              and a coin appears; click it and the coin drops in (CREDIT 01).
 *   0.52–0.86  the CREDITS roll up through the game screen (scroll-driven),
 *              with pixel fireworks — some of them burst into the Hark mark
 *   0.86–1.00  THANKS FOR PLAYING, the mark, fireworks. The end.
 *
 * The 3D props (mark, digits, coin door, coin) are toon-shaded voxels; all
 * text and 2D effects are drawn at the CRT's own game resolution
 * (PixelLayer), so every glyph pixel is exactly one game pixel.
 */

/** CSS px per game pixel in this level (fine 16-bit, so the ROM font reads) */
const PX = 3
/** CSS px per world unit (the camera is fitted so z = 0 maps 1:1) */
const U = 100
const FOV = 20

const T_TICK0 = 0.035
const TICK = 0.032
const T_FRIENDLY = T_TICK0 + TICK * 6
const T_OPEN = 0.245
const T_COMPACT = 0.5
const T_ROLL0 = 0.52
const T_ROLL1 = 0.86

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface TextItem {
  cv: HTMLCanvasElement
  x: number
  y: number
  blink?: boolean
}

interface Anchor {
  cx: number
  cy: number
  h: number
}

interface Stack {
  key: string
  items: TextItem[]
  /** the mark once the timer has stopped (centred) */
  mark: Anchor | null
  /** while the countdown runs: the mark on the left, the digit on the right */
  markPair: Anchor | null
  digit: Anchor | null
  door: Anchor | null
  /** where the coin hovers over the slot */
  coin: Anchor | null
  endMark: Anchor | null
  /** scroll (game px) at which the end block is centred */
  endScroll: number
}

const ST = {
  title: (s: number): TextStyle => ({
    scale: s,
    bands: [P.white, P.cream, P.gold, P.gold, P.orange, P.orange, P.coral],
    outline: P.void,
    shadow: P.purple,
  }),
  prompt: (s: number): TextStyle => ({ scale: s, bands: [P.white], outline: P.void }),
  arrow: (s: number): TextStyle => ({ scale: s, bands: [P.signal], outline: P.void }),
  credit: (): TextStyle => ({ scale: 1, bands: [P.steel], outline: P.void }),
  head: (s: number): TextStyle => ({
    scale: s,
    bands: [P.white, P.cream, P.gold, P.gold, P.orange, P.orange, P.coral],
    outline: P.void,
    shadow: P.purple,
  }),
  role: (): TextStyle => ({ scale: 1, bands: [P.cyan], outline: P.void }),
  name: (s: number): TextStyle => ({ scale: s, bands: [P.white], outline: P.void }),
  player: (s: number): TextStyle => ({ scale: s, bands: [P.signal], outline: P.void }),
  sub: (): TextStyle => ({ scale: 1, bands: [P.steel], outline: P.void }),
  thanks: (s: number): TextStyle => ({
    scale: s,
    bands: [P.white, P.cream, P.signal, P.signal, P.signal, P.green, P.green],
    outline: P.void,
    shadow: P.indigo,
  }),
  tag: (): TextStyle => ({ scale: 1, bands: [P.gold], outline: P.void }),
}

type Credit = ['gap'] | ['head' | 'sub' | 'role' | 'name' | 'player', string]
const CREDITS: Credit[] = [
  ['head', BRAND.name],
  ['sub', BRAND.locale],
  ['gap'],
  ['role', 'Directed by'],
  ['name', 'Listening'],
  ['gap'],
  ['role', 'Starring'],
  ['player', MICROCOPY.signalEyebrow],
  ['gap'],
  ['role', 'Special thanks'],
  ['name', 'Everyone who said hello'],
  ['gap'],
  ['role', 'Other games'],
  ['name', 'Classic · Orbit · Resonance · Press · Town'],
  ['gap'],
  ['role', 'Say hello'],
  ['player', BRAND.email],
]

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** largest integer scale ≤ max at which `text` fits `maxW` (1 if none) */
function fitScale(text: string, maxW: number, max: number) {
  for (let s = max; s > 1; s--) if (textWidth(text, s) + 3 <= maxW) return s
  return 1
}

/** heartbeat envelope (lub-dub), period 1.15 s */
function beat(t: number) {
  const p = ((t % 1.15) + 1.15) % 1.15
  const a = Math.exp(-((p - 0.04) ** 2) / 0.0016)
  const b = 0.6 * Math.exp(-((p - 0.24) ** 2) / 0.0016)
  return a + b
}

/** damped "slam" scale: big → 1 with a small wobble (t in s) */
function slam(t: number, amt = 0.55) {
  if (t < 0) return 1
  return 1 + amt * Math.exp(-t * 13) * Math.cos(t * 24)
}

export default function create(): Chapter {
  const group = new THREE.Group()
  const ui = new PixelLayer({ renderOrder: 1000, readback: true })
  const fx = new PixelLayer({ renderOrder: -5, gain: 1.25 })
  let hud!: Hud
  let lay: HudLayout | null = null
  let mark!: Mark
  let endMark!: Mark
  let door!: Door
  let coin!: THREE.Group
  let digits = new Map<number, THREE.Group>()
  const digitRoot = new THREE.Group()

  let W = 0
  let H = 0
  let now = 0
  let reduced = false
  let portrait = false
  // targets (canvas game px) and the damped rect the screen uses
  const rFull: Rect = { x: 0, y: 0, w: 1, h: 1 }
  const rCol: Rect = { x: 0, y: 0, w: 1, h: 1 }
  const rCompact: Rect = { x: 0, y: 0, w: 1, h: 1 }
  const art: Rect = { x: 0, y: 0, w: 1, h: 1 }
  let artSnap = true
  let fitKey = ''

  // the window (time-based stepped open/close toward a scroll-derived target)
  let openK = 0
  let openQ = -1
  let mode: 'full' | 'compact' = 'full'

  // countdown
  let shown = -2
  let shownAt = -1e9
  let friendlyAt = -1e9
  let credits = 0
  let lastCoin = -1e9
  let shake = { x: 0, y: 0 }
  let pairK = 1
  let artSnapPair = true

  let stack: Stack | null = null

  function toWorld(gx: number, gy: number, out: THREE.Vector3, z = 0) {
    const cx = ui.cssX(gx)
    const cy = ui.cssY(gy)
    return out.set((cx - W / 2) / U, (H / 2 - cy) / U, z)
  }
  /** world units per game px */
  const wpg = () => PX / U

  // ------------------------------------------------------------------ layout
  function cssToRect(x0: number, y0: number, x1: number, y1: number, out: Rect) {
    out.x = Math.round(ui.gx(x0))
    out.y = Math.round(ui.gy(y0))
    out.w = Math.max(1, Math.round(ui.gx(x1) - ui.gx(x0)))
    out.h = Math.max(1, Math.round(ui.gy(y1) - ui.gy(y0)))
  }

  function refit(frame: Frame) {
    const key = `${frame.width}x${frame.height}`
    if (!hud.dirty && key === fitKey && lay) return
    hud.dirty = false
    fitKey = key
    lay = measureHud(hud, frame.width, frame.height, mode)
    portrait = lay.portrait
    const s = lay.safe
    cssToRect(s.x0, s.y0, s.x1, s.y1, rFull)
    if (!portrait) {
      const gap = Math.max(28, frame.width * 0.028)
      cssToRect(lay.full.x1 + gap, s.y0, s.x1, s.y1, rCol)
      Object.assign(rCompact, rCol)
    } else {
      const gap = Math.max(10, frame.height * 0.016)
      cssToRect(s.x0, s.y0, s.x1, lay.full.y0 - gap, rCol)
      cssToRect(s.x0, s.y0, s.x1, lay.compact.y0 - gap, rCompact)
    }
  }

  function buildStack(R: Rect, open: boolean, typed: number, credit: number): Stack {
    const w = R.w
    const h = R.h
    const promptText = open ? (portrait ? '▼ INSERT COIN ▼' : '◀ INSERT COIN') : 'INSERT COIN'
    const key = `${w}x${h}|${open ? 1 : 0}|${portrait ? 1 : 0}|${typed}|${credit}`
    if (stack && stack.key === key) return stack
    const items: TextItem[] = []
    const cx = (cv: HTMLCanvasElement) => Math.round((w - cv.width) / 2)
    let mk: Anchor | null = null
    let dr: Anchor | null = null

    // ---- the CONTINUE? block (fills the screen rect at scroll 0)
    let mp: Anchor | null = null
    let dg: Anchor | null = null
    let cn: Anchor | null = null
    const arrows = (pcv: HTMLCanvasElement, x: number, y: number, s: number) => {
      if (!open) return
      const acv = lineCanvas(portrait ? '▼' : '◀', ST.arrow(s))
      items.push({ cv: acv, x, y, blink: true })
      if (portrait) items.push({ cv: acv, x: x + pcv.width - acv.width, y, blink: true })
    }
    if (h >= 92 && w >= 64) {
      const m = clamp(Math.round(h * 0.05), 2, 14)
      const tMax = h >= 200 && !open ? 4 : h >= 128 ? 3 : 2
      const ts = fitScale('CONTINUE?', w - 4, tMax)
      const full = lineCanvas('CONTINUE?', ST.title(ts))
      if (typed > 0) items.push({ cv: lineCanvas('CONTINUE?'.slice(0, typed), ST.title(ts)), x: cx(full), y: m })
      const titleB = m + full.height

      const ps = h >= 170 && w >= 190 ? 2 : 1
      const credH = h >= 110 ? lineHeight(1) + 5 : 0
      const dh = clamp(Math.round(h * 0.15), 16, 38)
      const coinH = Math.round(dh * 0.46)
      const pcv = lineCanvas(promptText, ST.prompt(ps))
      const rowH = Math.max(dh, pcv.height)
      const rowY = h - m - credH - rowH
      const dw = Math.round((dh * 13) / 16)
      const gapX = Math.max(5, Math.round(dh * 0.4))
      const rowW = pcv.width + gapX + dw
      const rx = Math.round((w - rowW) / 2)
      const py = rowY + Math.round((rowH - pcv.height) / 2)
      items.push({ cv: pcv, x: rx, y: py, blink: true })
      arrows(pcv, rx, py, ps)
      dr = { cx: rx + pcv.width + gapX + dw / 2, cy: rowY + rowH / 2, h: dh }
      cn = { cx: dr.cx, cy: rowY + rowH / 2 - dh / 2 - coinH * 0.72, h: coinH }
      if (credH) {
        const ccv = lineCanvas(`Credit ${String(credit).padStart(2, '0')}`, ST.credit())
        items.push({ cv: ccv, x: cx(ccv), y: h - m - ccv.height + 1 })
      }
      const zt = titleB + Math.max(4, Math.round(h * 0.035))
      const zb = rowY - Math.max(4, Math.round(h * 0.035)) - Math.round(coinH * 0.9)
      const zh = zb - zt
      const zc = (zt + zb) / 2
      const mh = Math.min(zh, Math.round(w * 0.6))
      if (mh >= 14) mk = { cx: w / 2, cy: zc, h: mh }
      // the countdown pair: [mark] [digit]
      let pm = Math.min(zh, w * 0.42)
      let pd = pm * 1.02
      let gp = pm * 0.16
      const tot = pm + gp + pd * (9 / 11)
      const f = Math.min(1, (w * 0.94) / tot)
      pm *= f
      pd *= f
      gp *= f
      const total = pm + gp + pd * (9 / 11)
      if (pm >= 14) {
        mp = { cx: w / 2 - total / 2 + pm / 2, cy: zc, h: pm }
        dg = { cx: w / 2 + total / 2 - (pd * (9 / 11)) / 2, cy: zc, h: pd }
      }
    } else if (h >= 30 && w >= 90) {
      // a strip: [mark] CONTINUE? / ▼ INSERT COIN ▼ [door]
      const pcv = lineCanvas(promptText, ST.prompt(1))
      let ts = h >= 50 ? 2 : 1
      if (Math.max(lineCanvas('CONTINUE?', ST.title(ts)).width, pcv.width) + 8 + 24 > w - 4) ts = 1
      const tfull = lineCanvas('CONTINUE?', ST.title(ts))
      const tcv = lineCanvas('CONTINUE?'.slice(0, Math.max(1, typed)), ST.title(ts))
      const colW = Math.max(tfull.width, pcv.width)
      const mh = Math.min(h - 4, 52, w - 4 - 8 - colW)
      const hasMark = mh >= 12
      const dh = Math.min(h - 6, 30)
      const dw = Math.round((dh * 13) / 16)
      let rowW = (hasMark ? mh + 8 : 0) + colW
      const withDoor = rowW + 8 + dw <= w - 4
      if (withDoor) rowW += 8 + dw
      const rx = Math.round((w - rowW) / 2)
      if (hasMark) mk = { cx: rx + mh / 2, cy: h / 2, h: mh }
      const x0 = rx + (hasMark ? mh + 8 : 0)
      const colH = tfull.height + 4 + pcv.height
      const ty = Math.round((h - colH) / 2)
      if (typed > 0) items.push({ cv: tcv, x: x0 + Math.round((colW - tfull.width) / 2), y: ty })
      const px = x0 + Math.round((colW - pcv.width) / 2)
      const py = ty + tfull.height + 4
      items.push({ cv: pcv, x: px, y: py, blink: true })
      arrows(pcv, px, py, 1)
      if (withDoor) dr = { cx: rx + rowW - dw / 2, cy: h / 2, h: dh }
    } else if (h >= 12 && w >= 60) {
      // a thin strip: [mark] ▼ INSERT COIN ▼
      const pcv = lineCanvas(promptText, ST.prompt(1))
      const mh = Math.min(h - 2, 30)
      const rowW = mh + 6 + pcv.width
      const rx = Math.round((w - rowW) / 2)
      mk = { cx: rx + mh / 2, cy: h / 2, h: mh }
      const py = Math.round((h - pcv.height) / 2)
      items.push({ cv: pcv, x: rx + mh + 6, y: py, blink: true })
      arrows(pcv, rx + mh + 6, py, 1)
    }

    // ---- the credits
    const nameScale = 1
    const lineGap = 3
    let y = h + Math.max(14, Math.round(h * 0.2))
    for (const c of CREDITS) {
      if (c[0] === 'gap') {
        y += nameScale > 1 ? 18 : 12
        continue
      }
      const [kind, text] = c
      let style: TextStyle
      let s = 1
      if (kind === 'head') {
        s = fitScale(text, w - 4, 2)
        style = ST.head(s)
      } else if (kind === 'name') {
        s = nameScale
        style = ST.name(s)
      } else if (kind === 'player') {
        s = textWidth(text, 2) + 3 <= w && w >= 150 ? 2 : 1
        style = ST.player(s)
      } else if (kind === 'role') style = ST.role()
      else style = ST.sub()
      for (const line of wrap(text, w - 4, s)) {
        const cv = lineCanvas(line, style)
        items.push({ cv, x: cx(cv), y })
        y += cv.height + lineGap
      }
      if (kind === 'role') y += 1
    }

    // ---- THANKS FOR PLAYING (centred in the screen rect at the end)
    y += Math.max(20, Math.round(h * 0.25))
    let thanks: string[] = []
    let tsc = 1
    for (let s = 3; s >= 1; s--) {
      const lines = wrap('Thanks for playing', w - 4, s)
      const fits = lines.every(l => textWidth(l, s) + 3 <= w)
      const tall = lines.length * (lineHeight(s) + 4)
      if (fits && lines.length <= (s === 1 ? 3 : w < 160 ? 3 : 2) && tall <= h * 0.6) {
        thanks = lines
        tsc = s
        break
      }
    }
    if (!thanks.length) thanks = wrap('Thanks for playing', w - 4, 1)
    const tag = wrap(BRAND.tagline, w - 6, 1)
    const tcvs = thanks.map(l => lineCanvas(l, ST.thanks(tsc)))
    const gcvs = tag.map(l => lineCanvas(l, ST.tag()))
    const textH = tcvs.reduce((a, c) => a + c.height + 2, 0) + 6 + gcvs.reduce((a, c) => a + c.height + 2, 0)
    let emh = clamp(Math.round(h * 0.34), 0, 80)
    emh = Math.min(emh, h - textH - 12)
    const endTop = y
    let em: Anchor | null = null
    if (emh >= 12) {
      em = { cx: w / 2, cy: y + emh / 2, h: emh }
      y += emh + Math.max(6, Math.round(h * 0.04))
    }
    for (const cv of tcvs) {
      items.push({ cv, x: cx(cv), y })
      y += cv.height + 2
    }
    y += 6
    for (const cv of gcvs) {
      items.push({ cv, x: cx(cv), y })
      y += cv.height + 2
    }
    const endScroll = Math.round((endTop + y) / 2 - h / 2)
    stack = { key, items, mark: mk, markPair: mp, digit: dg, door: dr, coin: cn, endMark: em, endScroll }
    return stack
  }

  // ------------------------------------------------------------------ drawing
  function drawUi(R: Rect, S: Stack, scroll: number, blinkOn: boolean) {
    const c = ui.ctx
    ui.begin()
    c.save()
    c.beginPath()
    c.rect(R.x - 3, R.y, R.w + 6, R.h)
    c.clip()
    for (const it of S.items) {
      const y = R.y + it.y - scroll
      if (y + it.cv.height < R.y || y > R.y + R.h) continue
      if (it.blink && !blinkOn) continue
      c.drawImage(it.cv, R.x + it.x, y)
    }
    c.restore()
    if (scroll > 0) {
      // the roll fades in and out through an ordered dither at the screen
      // rect's edges, the way old credits dissolve (no half-cut glyphs)
      const f = Math.min(8, Math.floor(R.h / 6))
      const x0 = Math.max(0, R.x - 3)
      const w = Math.min(ui.gw - x0, R.w + 6)
      for (const [y0, down] of [
        [R.y, true],
        [R.y + R.h - f, false],
      ] as const) {
        if (f < 2 || w < 1 || y0 < 0 || y0 + f > ui.gh) continue
        const img = c.getImageData(x0, y0, w, f)
        const d = img.data
        for (let yy = 0; yy < f; yy++) {
          const edge = down ? yy : f - 1 - yy
          const keep = ((edge + 1) / (f + 1)) * 16
          for (let xx = 0; xx < w; xx++) {
            if (BAYER[((y0 + yy) & 3) * 4 + ((x0 + xx) & 3)] >= keep) d[(yy * w + xx) * 4 + 3] = 0
          }
        }
        c.putImageData(img, x0, y0)
      }
    }
    ui.commit()
  }

  const _v = new THREE.Vector3()

  /** 0..1 as an object's centre leaves the screen rect (it pops out, stepped) */
  function edgeK(R: Rect, cy: number, h: number) {
    // full size while it's (almost) inside, gone once its centre is out
    const hh = h / 2
    const top = clamp((cy - R.y + hh * 0.15) / hh)
    const bot = clamp((R.y + R.h + hh * 0.15 - cy) / hh)
    return Math.round(Math.min(top, bot) * 4) / 4
  }

  // ------------------------------------------------------------------ chapter
  return {
    id: 'contact',
    group,

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      hud = buildHud(ctx.stage, () => now)
      group.add(ui.mesh, fx.mesh)
      await nextFrame()
      mark = buildMark()
      endMark = buildMark()
      endMark.mesh.material = endMark.lit
      group.add(mark.mesh, endMark.mesh)
      digits = buildDigits()
      for (const d of digits.values()) {
        d.visible = false
        digitRoot.add(d)
      }
      group.add(digitRoot)
      await nextFrame()
      door = buildDoor()
      coin = buildCoin()
      coin.visible = false
      group.add(door.group, coin)
    },

    onEnter() {
      openK = 0
      openQ = -1
      artSnap = true
      artSnapPair = true
    },

    onLeave() {
      openK = 0
      openQ = -1
      if (hud) {
        hud.win.classList.remove('is-open')
        hud.win.style.clipPath = ''
        setRise(hud.title, false)
      }
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      now = frame.time
      const t = frame.time
      const dt = Math.min(frame.dt, 0.1)
      W = frame.width
      H = frame.height
      const calm = reduced || frame.reducedMotion
      if (ui.resize(W, H, PX)) hud.dirty = true
      fx.resize(W, H, PX)
      refit(frame)

      // ---- the game window: open / close / swap mode, stepped, by time
      const wantOpen = local >= T_OPEN
      const wantMode: 'full' | 'compact' = portrait && local >= T_COMPACT ? 'compact' : 'full'
      const target = wantOpen && mode === wantMode ? 1 : 0
      const speed = dt / (calm ? 0.12 : 0.26)
      openK = target > openK ? Math.min(target, openK + speed) : Math.max(target, openK - speed * 1.6)
      if (openK <= 0 && mode !== wantMode) {
        mode = wantMode
        hud.stage.classList.toggle('ct-compact', mode === 'compact')
        hud.dirty = true
      }
      const q = Math.round(openK * 5) / 5
      if (q !== openQ) {
        openQ = q
        hud.win.classList.toggle('is-open', q > 0)
        hud.win.style.clipPath = q >= 1 ? '' : `inset(${((1 - q) * 50).toFixed(1)}% -14px ${((1 - q) * 50).toFixed(1)}% -14px)`
      }
      setRise(hud.title, q >= 1)

      // ---- the screen rect: full screen, or beside / above the window
      const tr = wantOpen ? (wantMode === 'compact' ? rCompact : rCol) : rFull
      if (artSnap) {
        Object.assign(art, tr)
        artSnap = false
      } else {
        const k = 1 - Math.exp(-9 * dt)
        art.x += (tr.x - art.x) * k
        art.y += (tr.y - art.y) * k
        art.w += (tr.w - art.w) * k
        art.h += (tr.h - art.h) * k
        if (Math.abs(tr.x - art.x) + Math.abs(tr.y - art.y) + Math.abs(tr.w - art.w) + Math.abs(tr.h - art.h) < 0.6) Object.assign(art, tr)
      }
      const R: Rect = { x: Math.round(art.x), y: Math.round(art.y), w: Math.round(art.w), h: Math.round(art.h) }

      // ---- countdown (scroll-derived); transitions play by time
      const typed = Math.min(9, Math.ceil(segment(local, 0.002, 0.03) * 9))
      const cd = local < T_TICK0 ? -1 : local >= T_FRIENDLY ? 0 : 9 - Math.floor((local - T_TICK0) / TICK)
      if (cd !== shown) {
        const prev = shown
        shown = cd
        shownAt = t
        if (cd === 0) {
          friendlyAt = t
          if (prev > 0) window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind: 'powerup', level: 0.8 } }))
        } else if (cd > 0) {
          friendlyAt = -1e9
          window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind: 'cursor', level: 0.9, pitch: cd - 4 } }))
        } else friendlyAt = -1e9
      }
      const friendly = cd === 0

      // ---- coins (the email button inserts one)
      if (hud.coinAt !== lastCoin && t - hud.coinAt < 0.05) {
        lastCoin = hud.coinAt
        credits = Math.min(99, credits + 1)
      }
      const coinAge = t - hud.coinAt

      // ---- lay out the screen
      const open = wantOpen && q > 0
      const S = buildStack(R, open, typed, credits)
      const rollK = segment(local, T_ROLL0, T_ROLL1)
      const scroll = Math.round(S.endScroll * (rollK < 1 ? rollK * (1.08 - 0.08 * rollK) : 1))
      const blinkOn = calm || (t % 1.1) < 0.75

      // ---- screen shake (whole game px)
      let sx = 0
      let sy = 0
      if (!calm) {
        const hitA = t - friendlyAt
        const hitB = coinAge - 0.32
        const amp = (hitA >= 0 && hitA < 0.18 ? 1 : 0) + (hitB >= 0 && hitB < 0.24 ? 2 : 0)
        if (amp) {
          const f = Math.floor(t * 30)
          sx = Math.round((((f * 7) % 5) / 2 - 1) * amp)
          sy = Math.round((((f * 3) % 5) / 2 - 1) * amp)
        }
      }
      shake = { x: sx, y: sy }
      ui.place(sx, sy)
      fx.place(sx, sy)

      // ---- UI layer (text): redraw only when something visible changed
      const uiKey = `${S.key}|${R.x},${R.y},${R.w},${R.h}|${scroll}|${blinkOn ? 1 : 0}`
      if (uiKey !== ui.key) {
        ui.key = uiKey
        drawUi(R, S, scroll, blinkOn)
      }

      // ---- 3D props
      const g = wpg()
      const tStep = Math.floor(t * 8) / 8
      // pair (countdown) ↔ solo (timer stopped), a stepped slide by time
      const pairT = cd > 0 ? 1 : 0
      if (artSnapPair) {
        pairK = pairT
        artSnapPair = false
      } else pairK = pairT > pairK ? Math.min(1, pairK + dt / 0.3) : Math.max(0, pairK - dt / 0.3)
      const pk = calm ? pairT : Math.round((pairK * pairK * (3 - 2 * pairK)) * 6) / 6

      // the mark on the CONTINUE? screen
      let markAt: { x: number; y: number; h: number } | null = null
      if (S.mark) {
        const a = S.mark
        const b = S.markPair ?? a
        const ax = lerp(a.cx, b.cx, pk)
        const ah = lerp(a.h, b.h, pk)
        const cy = R.y + lerp(a.cy, b.cy, pk) - scroll
        const ek = edgeK(R, cy, ah)
        mark.mesh.visible = ek > 0
        toWorld(R.x + ax, cy, mark.mesh.position, 0)
        const fAge = t - friendlyAt
        let sc = ah * g
        const hb = calm ? 0 : beat(Math.floor(t * 12) / 12)
        if (friendly) {
          sc *= slam(fAge - 0.1, calm ? 0 : 0.3) * (1 + 0.05 * hb)
          mark.mesh.material = fAge >= 0 && fAge < 0.1 && !calm ? mark.flash : mark.lit
        } else {
          sc *= 1 + 0.045 * hb
          mark.mesh.material = mark.dim
        }
        mark.mesh.scale.setScalar(sc * ek)
        const sway = calm ? 0 : Math.sin(tStep * 1.4) * 0.2
        mark.mesh.rotation.set(frame.pointer.y * -0.12, sway + frame.pointer.x * 0.2, 0)
        if (ek > 0) markAt = { x: R.x + ax, y: cy, h: ah }
      } else mark.mesh.visible = false

      // the countdown digit beside it
      for (const d of digits.values()) d.visible = false
      let digitAt: { x: number; y: number; h: number } | null = null
      if (S.digit) {
        const a = S.digit
        const cy = R.y + a.cy - scroll
        const ek = edgeK(R, cy, a.h)
        digitAt = { x: R.x + a.cx, y: cy, h: a.h }
        const flipping = friendly && t - friendlyAt < 0.24 && !calm
        const n = cd > 0 ? cd : 4
        const d = digits.get(n)
        if (d && ek > 0 && (cd > 0 || flipping)) {
          d.visible = true
          const base = (a.h * g) / ((DIGIT_H + 2) * 0.1)
          toWorld(R.x + a.cx, cy, digitRoot.position, 0.4)
          if (cd > 0) {
            const age = Math.floor((t - shownAt) * 20) / 20
            digitRoot.scale.setScalar(base * (calm ? 1 : slam(age)) * ek)
            digitRoot.rotation.set(0, 0, calm ? 0 : Math.max(0, 0.16 - age * 1.1) * (n % 2 ? 1 : -1))
          } else {
            // the flip away: the timer gives up, there is no GAME OVER here
            const u = Math.floor(clamp((t - friendlyAt) / 0.24) * 8) / 8
            digitRoot.scale.set(base * (1 + u * 0.4), base * (1 - u), base)
            digitRoot.rotation.set(0, u * Math.PI * 0.5, 0)
          }
        }
      }

      // coin door + coin
      coin.visible = false
      if (S.door) {
        const a = S.door
        const cy = R.y + a.cy - scroll
        const ek = edgeK(R, cy, a.h)
        door.group.visible = ek > 0
        toWorld(R.x + a.cx, cy, door.group.position, 0)
        const vox = a.h / DOOR_H
        door.group.scale.setScalar(((a.h * g) / (DOOR_H * 0.1)) * ek)
        door.group.rotation.set(0, calm ? -0.1 : Math.sin(tStep * 1.1) * 0.1 - 0.12, 0)
        // the slot glows; green and bright while the email has your attention
        const hot = open && (hud.hover || (coinAge >= 0 && coinAge < 0.9))
        const pulse = calm ? 0.6 : Math.floor(t * 3) % 3 < 2 ? 1 : 0.35
        door.slot.color.set(hot ? P.signal : P.coral).multiplyScalar(hot ? 2.3 : 1.05 + 0.9 * pulse * (open ? 1 : 0.6))
        // the coin spins over the slot; hover and it sinks toward it; click
        // the email button and it drops in (then a fresh one pops back)
        if (S.coin && ek >= 1 && edgeK(R, R.y + S.coin.cy - scroll, S.coin.h) >= 1) {
          const c = S.coin
          const slotY = cy - SLOT_DY * vox
          const rest = R.y + c.cy - scroll
          const drop = coinAge >= 0 && coinAge < 0.36
          const gone = coinAge >= 0.36 && coinAge < 1.1
          if (!gone) {
            coin.visible = true
            const cs = (c.h * g) / (COIN_W * 0.1)
            const hover = hud.hover && open
            const bob = calm ? 0 : Math.round(Math.sin(t * (hover ? 9 : 4)) * (hover ? 1 : 1.5))
            let y = (hover ? lerp(rest, slotY - c.h * 0.9, 0.55) : rest) + bob
            let sx = cs
            let spin = calm ? 0 : (Math.floor(t * (hover ? 12 : 8)) % 8) * (Math.PI / 8)
            if (drop) {
              const u = Math.floor(clamp(coinAge / 0.3) * 6) / 6
              y = lerp(y, slotY, u * u)
              spin = Math.PI / 2
              if (u >= 1) coin.visible = false
            }
            const back = coinAge >= 1.1 && coinAge < 1.5 ? slam(coinAge - 1.1, -0.6) : 1
            sx *= Math.max(0.2, back)
            toWorld(R.x + c.cx, y, coin.position, 0.55)
            coin.scale.set(sx, cs * Math.max(0.2, back), cs)
            coin.rotation.set(0, spin, 0)
          }
        }
      } else door.group.visible = false

      // the mark at the end of the credits
      let endAt: { x: number; y: number; h: number } | null = null
      if (S.endMark) {
        const a = S.endMark
        const cy = R.y + a.cy - scroll
        const ek = edgeK(R, cy, a.h)
        endMark.mesh.visible = ek > 0
        toWorld(R.x + a.cx, cy, endMark.mesh.position, 0)
        const hb = calm ? 0 : beat(Math.floor(t * 12) / 12 + 0.4)
        const bob = calm ? 0 : Math.round(Math.sin(t * 2.2) * 1.2)
        endMark.mesh.position.y -= bob * g
        endMark.mesh.scale.setScalar(a.h * g * (1 + 0.05 * hb) * ek)
        endMark.mesh.rotation.set(frame.pointer.y * -0.12, (calm ? 0 : Math.sin(tStep * 1.3) * 0.3) + frame.pointer.x * 0.2, 0)
        if (ek > 0) endAt = { x: R.x + a.cx, y: cy + bob, h: a.h }
      } else endMark.mesh.visible = false

      // ---- FX layer (stars, heartbeat rings, sparks, fireworks) at 12 fps
      const step = Math.floor(t * 12)
      const fwAmt = segment(local, 0.5, 0.84)
      const fxKey = `${step}|${R.x},${R.y},${R.w},${R.h}|${scroll}|${Math.round(fwAmt * 40)}|${W}x${H}|${pk}`
      if (fxKey !== fx.key) {
        fx.key = fxKey
        fx.begin()
        const c = fx.ctx
        drawStars(c, fx.gw, fx.gh, calm ? 0 : t, scroll, calm)
        // rings and sparks stay inside the game screen
        c.save()
        c.beginPath()
        c.rect(0, R.y - 2, fx.gw, R.h + 4)
        c.clip()
        if (markAt && !calm) {
          const p = ((t % 1.15) + 1.15) % 1.15
          const rr = markAt.h * 0.56 + p * markAt.h * 0.5
          const col = friendly ? (p < 0.35 ? P.signal : p < 0.7 ? P.green : P.pine) : p < 0.4 ? P.steel : P.slate
          if (p < 0.95) ring(c, markAt.x, markAt.y, rr, col, p < 0.3 ? 1 : 2)
          sparkBurst(c, markAt.x, markAt.y, t - friendlyAt - 0.05, markAt.h * 0.95, [P.white, P.gold, P.signal, P.green], 7, 20)
        }
        if (digitAt && !calm) sparkBurst(c, digitAt.x, digitAt.y, t - friendlyAt, digitAt.h * 0.7, [P.white, P.gold, P.orange, P.coral], 13, 14)
        if (S.door && door.group.visible) {
          const a = S.door
          const slotY = R.y + a.cy - scroll - SLOT_DY * (a.h / DOOR_H)
          sparkBurst(c, R.x + a.cx, slotY, coinAge - 0.3, a.h * 1.5, [P.white, P.gold, P.signal, P.green], 3, 16)
        }
        if (endAt && !calm) {
          const p = (((t + 0.4) % 1.15) + 1.15) % 1.15
          if (p < 0.9) ring(c, endAt.x, endAt.y, endAt.h * 0.58 + p * endAt.h * 0.45, p < 0.35 ? P.signal : P.green, 2)
        }
        c.restore()
        drawFireworks(c, { x: R.x, y: R.y, w: R.w, h: R.h }, t, fwAmt, calm)
        fx.commit()
      }

      // ---- post + world: a black CRT, fine pixels, glow only on the brights
      const pp = ctx.post.params
      pp.pixel = PX
      // only true HDR brights bloom (the slot, fireworks, stars): the ROM text stays crisp
      pp.bloomThreshold = 1.0
      pp.bloomStrength = 0.7
      pp.bloomRadius = 0.4
      pp.aberration = 0.0006
      pp.dither = 0.5
      pp.vignette = 0.4
      if (!calm && coinAge >= 0.3 && coinAge < 0.45) pp.flash = 0.22 * (1 - (coinAge - 0.3) / 0.15)
      const wp = ctx.world.params
      wp.top = P.void
      wp.bottom = P.void
      wp.stars = 0
      wp.keyDir.set(-0.35, 0.55, 1)
      wp.key = 2.3
      wp.fill = 0.85
    },

    camera(_local: number, frame: Frame, out: CameraPose) {
      const h = frame.height || 1
      const d = h / U / (2 * Math.tan((FOV * Math.PI) / 360))
      // move the camera against the shake so the 3D moves with the 2D layers
      const sx = (-shake.x * PX) / U
      const sy = (shake.y * PX) / U
      out.position.set(sx, sy, d)
      out.target.set(sx, sy, 0)
      out.fov = FOV
      out.parallax = 0
    },
  }
}
