import { BRAND, MICROCOPY } from '../content'
import { mountRotateGate } from './rotate'
import { holdInert, releaseInert } from './inert'
import { storedAudio } from './sound'
import { MARK_TITLE, pixelMark } from './pixelart'

/*
 * Boot screen: the console powers on, then hands over to the game.
 *
 *   BOOT   a black CRT. "HARK SYSTEM v2.6" and a few BIOS checks type out in
 *          VT323 (CPU, a memory count, video, sound, input … OK), then
 *          "LOADING LEVELS…" and a segmented pixel progress bar that fills
 *          with progress(). It never looks frozen: a stalled load keeps a
 *          slow creep and, after a while, says so.
 *   READY  on finish(): the bar lands on 100%, LOADING LEVELS reads OK and
 *          "PLAYER 1 · GET READY" comes up under it. This is a hand-off, not
 *          a second title screen: it never asks for a press (the site's own
 *          title screen, the hero, is the one with PRESS START). Any key,
 *          click or tap just hurries it along.
 *   EXIT   a pixel iris (a low-res canvas, 4px cells like the CRT pass)
 *          closes on the OEM mark, then opens on the title screen of the site.
 *
 * Minimum ~1.3s on screen, never hangs (every wait is a timer; a hidden tab
 * skips straight through). Everything behind it is inert while it is up.
 * Reduced motion: the text is simply there, no blinking, and the exit is a
 * plain crossfade.
 *
 * API: createLoader(root, { skip }) -> { progress(0..1), finish(): Promise<void> }
 * finish() resolves as the iris starts to open (so the chrome's reveal
 * overlaps it); the node removes itself once the picture is fully open.
 */

const MIN_DISPLAY = 1.3 // seconds before the bar may reach 100
const SLOW_AFTER = 10 // seconds without finish() before the status admits a slow load
const TYPE_CPS = 150 // typing speed, characters per second
const SEGMENTS = 20
const CELL = 4 // CSS px per iris pixel (matches the CRT pass default)

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** a BIOS check line: label, dot leader, value (fixed width; VT323 is monospace) */
const LINE_W = 24
const COUNT_S = 0.3 // seconds the memory count takes

interface BootLine {
  prefix: string
  text: string
  ok: string
  count?: number
}
const bootLine = (label: string, value: string, ok: string, count?: number): BootLine => {
  const prefix = `${label} ${'.'.repeat(Math.max(2, LINE_W - label.length - value.length - 2))} `
  return { prefix, text: prefix + value, ok, count }
}

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  // phones held sideways get the rotate card from the very first frame
  mountRotateGate()
  if (skip) {
    root.remove()
    return { progress() {}, finish: () => Promise.resolve() }
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const soundLine = storedAudio() ? 'READY' : 'MUTED'
  const LINES: BootLine[] = [
    bootLine('CPU', 'HARK-16', 'OK'),
    bootLine('MEMORY', '4096K', 'OK', 4096),
    bootLine('VIDEO', 'CRT', 'OK'),
    bootLine('SOUND', 'CHIPTUNE', soundLine),
    bootLine('INPUT', MICROCOPY.signalEyebrow.toUpperCase(), 'OK'),
  ]

  root.innerHTML = `
  <div class="ld" data-phase="boot">
    <p class="sr-only" role="status">Loading ${BRAND.name}</p>
    <div class="ld-screen" aria-hidden="true">
      <div class="ld-boot">
        <div class="ld-head">
          <p class="ld-head-t"><span class="ld-sys">HARK SYSTEM v2.6</span><span class="ld-loc">${BRAND.locale.toUpperCase()}</span></p>
        </div>
        <ol class="ld-lines">${LINES.map(
          (l, i) =>
            `<li class="ld-line" data-i="${i}"><span class="ld-txt"></span><span class="ld-ok${l.ok === 'OK' ? '' : ' ld-ok--note'}">${l.ok}</span><span class="ld-caret"></span></li>`,
        ).join('')}</ol>
        <div class="ld-load">
          <p class="ld-load-t"><span class="ld-load-k">LOADING LEVELS</span><span class="ld-ell"><i>.</i><i>.</i><i>.</i></span><span class="ld-load-ok">OK</span></p>
          <div class="ld-bar"><span class="ld-segs">${'<i></i>'.repeat(SEGMENTS)}</span><span class="ld-pct">000%</span></div>
          <p class="ld-slow">STILL LOADING, NEARLY THERE</p>
          <p class="ld-ready"><span class="ld-ready-k">${MICROCOPY.signalEyebrow.toUpperCase()}</span><span class="ld-ready-t">GET READY</span></p>
        </div>
      </div>
      <span class="ld-oem">${pixelMark(30, MARK_TITLE)}</span>
      <p class="ld-foot"><span>${BRAND.short.toUpperCase()}</span><span class="ld-foot-t">${BRAND.tagline.toUpperCase()}</span></p>
    </div>
    <canvas class="ld-iris"></canvas>
  </div>`

  const wrap = root.querySelector<HTMLElement>('.ld')!
  const screen = root.querySelector<HTMLElement>('.ld-screen')!
  const lineEls = [...root.querySelectorAll<HTMLElement>('.ld-line')]
  const txtEls = lineEls.map(l => l.querySelector<HTMLElement>('.ld-txt')!)
  const loadEl = root.querySelector<HTMLElement>('.ld-load')!
  const segs = [...root.querySelectorAll<HTMLElement>('.ld-segs i')]
  const pctEl = root.querySelector<HTMLElement>('.ld-pct')!
  const oem = root.querySelector<HTMLElement>('.ld-oem')!
  const iris = root.querySelector<HTMLCanvasElement>('.ld-iris')!
  const live = root.querySelector<HTMLElement>('[role="status"]')!

  // nothing behind the loader is reachable while it is up
  holdInert('loader', [
    ...['chrome', 'stages', 'track'].map(id => document.getElementById(id)),
    document.querySelector<HTMLElement>('.skip-link'),
  ])

  // ------------------------------------------------------------ boot typing

  /** when each line starts typing (s), from the text lengths */
  const starts: number[] = []
  let tt = 0.12
  for (const l of LINES) {
    starts.push(tt)
    tt += (l.count ? l.prefix.length / TYPE_CPS + COUNT_S : l.text.length / TYPE_CPS) + 0.05
  }
  const loadAt = tt

  const t0 = performance.now()
  let target = 0
  let shown = 0
  let finishing = false
  let slow = false
  let raf = 0
  let last = t0
  let typedAll = false
  let lastSegs = -1
  let lastPct = ''

  const type = (elapsed: number) => {
    if (typedAll) return
    let all = true
    LINES.forEach((l, i) => {
      const t = elapsed - starts[i]
      let txt: string
      let done: boolean
      if (reduced) {
        txt = l.text
        done = true
      } else if (l.count) {
        // the memory check types its label, then counts up to the value
        const n = Math.floor(t * TYPE_CPS)
        if (n <= l.prefix.length) {
          txt = l.prefix.slice(0, Math.max(0, n))
          done = false
        } else {
          const k = clamp01((t - l.prefix.length / TYPE_CPS) / COUNT_S)
          txt = `${l.prefix}${String(Math.floor(l.count * k)).padStart(4, '0')}K`
          done = k >= 1
        }
      } else {
        const n = Math.max(0, Math.min(l.text.length, Math.floor(t * TYPE_CPS)))
        txt = l.text.slice(0, n)
        done = n >= l.text.length
      }
      if (txtEls[i].textContent !== txt) txtEls[i].textContent = txt
      const state = done ? 'done' : txt ? 'typing' : 'wait'
      if (lineEls[i].dataset.state !== state) lineEls[i].dataset.state = state
      if (!done) all = false
    })
    const loadOn = reduced || elapsed >= loadAt
    if (loadOn !== loadEl.classList.contains('is-on')) loadEl.classList.toggle('is-on', loadOn)
    if (all && loadOn) typedAll = true
  }

  const draw = () => {
    const n = Math.round(clamp01(shown) * SEGMENTS)
    if (n !== lastSegs) {
      lastSegs = n
      segs.forEach((s, i) => s.classList.toggle('on', i < n))
    }
    const pct = `${String(Math.min(100, Math.floor(shown * 100 + 1e-4))).padStart(3, '0')}%`
    if (pct !== lastPct) {
      lastPct = pct
      pctEl.textContent = pct
    }
  }

  const tick = (now: number) => {
    // boot failed and the node was taken away: stop quietly
    if (!root.isConnected) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const elapsed = (now - t0) / 1000
    type(elapsed)
    // the bar only starts once LOADING LEVELS is on screen, and the time cap
    // keeps the fill readable even when loading is instant
    const cap = finishing ? 1 : elapsed < loadAt ? 0 : Math.min(0.97, (elapsed - loadAt) / Math.max(0.3, MIN_DISPLAY - loadAt))
    const creep = Math.min(0.9, shown + dt * 0.02)
    const goal = Math.min(cap, Math.max(target, finishing ? 1 : creep))
    shown += (goal - shown) * (1 - Math.exp(-(finishing ? 14 : 7) * dt))
    if (finishing && goal - shown < 0.004) shown = 1
    if (!finishing && !slow && elapsed > SLOW_AFTER) {
      slow = true
      wrap.classList.add('is-slow')
    }
    draw()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  type(reduced ? 99 : 0)
  draw()

  // ------------------------------------------------------------ pixel iris

  /** Draw black everywhere except a circle of radius r (in cells) at (cx, cy) cells. */
  let ictx: CanvasRenderingContext2D | null = null
  const sizeIris = () => {
    const w = Math.ceil(window.innerWidth / CELL)
    const h = Math.ceil(window.innerHeight / CELL)
    iris.width = w
    iris.height = h
    iris.style.width = `${w * CELL}px`
    iris.style.height = `${h * CELL}px`
    ictx = iris.getContext('2d')
    return { w, h }
  }
  const drawIris = (w: number, h: number, cx: number, cy: number, r: number) => {
    const c = ictx
    if (!c) return
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#0b0d14'
    c.fillRect(0, 0, w, h)
    if (r <= 0) return
    const y0 = Math.max(0, Math.floor(cy - r))
    const y1 = Math.min(h, Math.ceil(cy + r))
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy
      const span = r * r - dy * dy
      if (span <= 0) continue
      const half = Math.sqrt(span)
      const x0 = Math.max(0, Math.round(cx - half))
      const x1 = Math.min(w, Math.round(cx + half))
      if (x1 > x0) c.clearRect(x0, y, x1 - x0, 1)
    }
  }
  /** animate the iris radius from r0 to r1 (0..1 of the cover radius) over ms; always resolves */
  const irisTo = (from: number, to: number, ms: number, center: { x: number; y: number }) =>
    new Promise<void>(resolve => {
      const { w, h } = sizeIris()
      const cx = center.x / CELL
      const cy = center.y / CELL
      const cover = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 1
      const start = performance.now()
      let done = false
      const end = () => {
        if (done) return
        done = true
        drawIris(w, h, cx, cy, to * cover)
        resolve()
      }
      const step = (now: number) => {
        if (done) return
        const k = clamp01((now - start) / ms)
        // ease: closing accelerates, opening decelerates
        const e = to < from ? k * k : 1 - (1 - k) * (1 - k)
        drawIris(w, h, cx, cy, (from + (to - from) * e) * cover)
        if (k >= 1) end()
        else requestAnimationFrame(step)
      }
      if (document.hidden) end()
      else requestAnimationFrame(step)
      // a hidden tab has no rAF: never wait on it
      window.setTimeout(end, ms + 250)
    })

  // ------------------------------------------------------------ finish

  let hurry: (() => void) | null = null
  const onHurry = (e: Event) => {
    if (e instanceof KeyboardEvent && !['Enter', ' ', 'Escape'].includes(e.key)) return
    hurry?.()
  }

  let finished: Promise<void> | null = null

  return {
    progress(p: number) {
      if (Number.isFinite(p)) target = Math.max(target, clamp01(p))
    },
    finish(): Promise<void> {
      if (finished) return finished
      finished = (async () => {
        const elapsed = (performance.now() - t0) / 1000
        if (elapsed < MIN_DISPLAY) await wait((MIN_DISPLAY - elapsed) * 1000)
        finishing = true
        target = 1
        // let the bar land on 100 (capped: a hidden tab has no rAF)
        const land = performance.now()
        while (shown < 1 && performance.now() - land < 700) await wait(30)
        shown = 1
        typedAll = false
        type(99)
        draw()
        wrap.classList.remove('is-slow')
        wrap.dataset.phase = 'loaded'
        await wait(reduced ? 120 : 200)

        // READY: the hand-off line (no PRESS START here: nothing waits for a press)
        wrap.dataset.phase = 'ready'
        live.textContent = `${BRAND.short} loaded. ${MICROCOPY.signalEyebrow}, get ready.`
        window.addEventListener('keydown', onHurry, true)
        window.addEventListener('pointerdown', onHurry, true)
        await new Promise<void>(r => {
          const t = window.setTimeout(r, reduced ? 650 : 620)
          hurry = () => {
            clearTimeout(t)
            r()
          }
        })
        hurry = null
        window.removeEventListener('keydown', onHurry, true)
        window.removeEventListener('pointerdown', onHurry, true)

        if (reduced || document.hidden) {
          // no iris: a plain crossfade (WAAPI, so the global reduced-motion
          // transition kill in base.css cannot turn it into a hard cut)
          cancelAnimationFrame(raf)
          releaseInert('loader')
          root.style.pointerEvents = 'none'
          live.textContent = ''
          if (typeof wrap.animate === 'function' && !document.hidden) {
            const fade = wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease', fill: 'forwards' })
            fade.finished
              .catch(() => {})
              .then(() => root.remove())
            window.setTimeout(() => root.remove(), 900)
          } else root.remove()
          await wait(120)
          return
        }

        // EXIT: the iris closes on the OEM mark…
        const r = oem.getBoundingClientRect()
        const at = r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 }
        wrap.dataset.phase = 'iris'
        await irisTo(1, 0, 360, at)
        cancelAnimationFrame(raf)
        // …the console screen is lifted away behind the black…
        screen.style.visibility = 'hidden'
        wrap.dataset.phase = 'open'
        releaseInert('loader')
        root.style.pointerEvents = 'none'
        live.textContent = ''
        await wait(70)
        // …and it opens on the title screen
        const opened = irisTo(0, 1, 560, { x: innerWidth / 2, y: innerHeight * 0.48 })
        opened.then(() => root.remove())
        window.setTimeout(() => root.remove(), 1400)
        await wait(60)
      })()
      return finished
    },
  }
}
