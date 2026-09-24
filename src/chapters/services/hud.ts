import { el, rise, setRise } from '../../core/dom'
import { MICROCOPY, SECTIONS, SERVICES } from '../../content'
import { ICONS, SHORT } from './art'
import { artDataUrl } from './gfx'

/*
 * Game UI for Power-Ups. Scroll decides WHAT is up; CSS (stepped) decides how
 * it arrives, so wherever the scroll rests the copy is settled and exact.
 *
 *   ready   "READY?" as the iris opens
 *   intro   window: "What we do" · Eleven ways to be heard. · INVENTORY list
 *           of all eleven power-ups (each lands on its block)
 *   card    ITEM CARD window: ITEM 07 / 11, icon slot, title, blurb (types
 *           out fast, then settles to the exact text), tags, and a 01–11
 *           inventory bar that lands on each item
 *   power   POWER UP! as all eleven items orbit the player
 */

const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const titleHtml = (t: string) => {
  const i = t.lastIndexOf(' ')
  return i < 0 ? `<em>${esc(t)}</em>` : `${esc(t.slice(0, i))} <em>${esc(t.slice(i + 1))}</em>`
}
const setOn = (node: Element, on: boolean, cls = 'is-on') => {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on)
}

export interface HudBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface HudMetrics {
  w: number
  h: number
  /** portrait / narrow: scene on top, windows at the bottom */
  tall: boolean
  safeTop: number
  safeBottom: number
  gutter: number
  card: HudBox
  intro: HudBox
}

export interface HudState {
  ready: boolean
  intro: boolean
  /** -1 = no card, else the item the card names */
  shown: number
  /** how many items are collected (for the bar) */
  got: number
  power: boolean
}

interface Slide {
  root: HTMLElement
  title: HTMLElement
  typed: HTMLElement
  rest: HTMLElement
  text: string
}

export class Hud {
  private ready: HTMLElement
  private intro: HTMLElement
  private introWin: HTMLElement
  private introTitle: HTMLElement
  private card: HTMLElement
  private cardWin: HTMLElement
  private slides: Slide[] = []
  private bar: HTMLButtonElement[] = []
  private power: HTMLElement
  private powerTitle: HTMLElement
  private probe: HTMLElement
  private last: HudState = { ready: false, intro: false, shown: -2, got: -1, power: false }
  private typeT0 = 0
  private typing = -1
  private dirty = true
  private m: HudMetrics = {
    w: 0,
    h: 0,
    tall: false,
    safeTop: 0,
    safeBottom: 0,
    gutter: 16,
    card: { left: 0, top: 0, right: 0, bottom: 0 },
    intro: { left: 0, top: 0, right: 0, bottom: 0 },
  }

  constructor(
    private stage: HTMLElement,
    jump: (k: number) => void,
    private calm: boolean,
  ) {
    const icons = ICONS.map(artDataUrl)

    /* READY? */
    this.ready = el('div', 'svc-ready', undefined, stage)
    el('span', 'svc-ready-lv', 'Level 3 · Power-Ups', this.ready)
    el('b', 'svc-ready-go', 'Ready?', this.ready)

    /* intro window */
    this.intro = el('section', 'svc-col svc-intro', undefined, stage)
    this.introWin = el('div', 'hud-panel svc-win', undefined, this.intro)
    el('p', 'hud-eyebrow', SECTIONS.services.eyebrow, this.introWin)
    this.introTitle = rise(el('h2', 'hud-h2 svc-intro-title', undefined, this.introWin), 'Eleven ways to be <em>heard.</em>')
    const head = el('div', 'svc-inv-head', undefined, this.introWin)
    el('span', '', 'Inventory', head)
    el('span', '', `${SERVICES.length} items`, head)
    const list = el('ol', 'svc-inv', undefined, this.introWin)
    SERVICES.forEach((s, k) => {
      const li = el('li', '', undefined, list)
      const b = el('button', 'svc-slot', undefined, li)
      b.type = 'button'
      b.title = s.title
      b.setAttribute('aria-label', `Item ${s.num}: ${s.title}`)
      const img = el('img', '', undefined, b)
      img.src = icons[k]
      img.alt = ''
      img.style.setProperty('--w', String(ICONS[k][0].length))
      el('span', 'svc-slot-num', s.num, b)
      el('span', 'svc-slot-name', SHORT[k], b)
      b.addEventListener('click', () => jump(k))
    })
    const hint = el('p', 'svc-hint', undefined, this.introWin)
    el('span', '', MICROCOPY.scrollHint, hint)
    el('i', 'svc-hint-arrow', undefined, hint).setAttribute('aria-hidden', 'true')

    /* the item card */
    this.card = el('section', 'svc-col svc-card', undefined, stage)
    this.cardWin = el('div', 'hud-panel svc-win', undefined, this.card)
    const slides = el('div', 'svc-slides', undefined, this.cardWin)
    SERVICES.forEach((s, k) => {
      const root = el('article', 'svc-slide', undefined, slides)
      const head = el('header', 'svc-card-head', undefined, root)
      const count = el('p', 'svc-count', undefined, head)
      count.append('Item ')
      el('b', '', s.num, count)
      count.append(` / ${pad(SERVICES.length)}`)
      el('p', 'svc-get', 'Power-up!', head)
      const top = el('div', 'svc-slide-top', undefined, root)
      const frame = el('div', 'svc-frame', undefined, top)
      const img = el('img', '', undefined, frame)
      img.src = icons[k]
      img.alt = ''
      img.style.setProperty('--w', String(ICONS[k][0].length))
      const title = rise(el('h3', 'hud-h2 svc-title', undefined, top), titleHtml(s.title))
      const blurb = el('p', 'hud-body svc-blurb', undefined, root)
      blurb.setAttribute('aria-label', s.blurb)
      const typed = el('span', 'svc-typed', s.blurb, blurb)
      const rest = el('span', 'svc-rest', '', blurb)
      rest.setAttribute('aria-hidden', 'true')
      const tags = el('ul', 'hud-tags svc-tags', undefined, root)
      for (const t of s.tags) el('li', 'hud-tag', t, tags)
      this.slides.push({ root, title, typed, rest, text: s.blurb })
    })
    const bar = el('nav', 'svc-bar', undefined, this.cardWin)
    SERVICES.forEach((s, k) => {
      const b = el('button', 'svc-pip', undefined, bar)
      b.type = 'button'
      b.title = s.title
      b.setAttribute('aria-label', `Item ${s.num}: ${s.title}`)
      el('span', '', s.num, b)
      b.addEventListener('click', () => jump(k))
      this.bar.push(b)
    })

    /* POWER UP! */
    this.power = el('div', 'svc-power', undefined, stage)
    this.powerTitle = el('p', 'hud-title svc-power-title', undefined, this.power)
    this.powerTitle.innerHTML = 'Power <em>up!</em>'
    el('p', 'svc-power-sub', `${pad(SERVICES.length)} / ${pad(SERVICES.length)} power-ups`, this.power)

    /* a probe that spans the safe area, to read its px bounds */
    this.probe = el('div', 'svc-probe', undefined, stage)
    this.probe.setAttribute('aria-hidden', 'true')

    const ro = new ResizeObserver(() => (this.dirty = true))
    for (const n of [stage, this.introWin, this.cardWin, this.probe]) ro.observe(n)
  }

  metrics(): HudMetrics {
    if (this.dirty) {
      this.dirty = false
      const m = this.m
      m.w = this.stage.offsetWidth
      m.h = this.stage.offsetHeight
      m.tall = m.w < 768 || m.w / Math.max(1, m.h) < 0.8
      m.safeTop = this.probe.offsetTop
      m.safeBottom = m.h - (this.probe.offsetTop + this.probe.offsetHeight)
      m.gutter = this.probe.offsetLeft
      const box = (col: HTMLElement, win: HTMLElement, out: HudBox) => {
        out.left = col.offsetLeft + win.offsetLeft
        out.top = col.offsetTop + win.offsetTop
        out.right = out.left + win.offsetWidth
        out.bottom = out.top + win.offsetHeight
      }
      box(this.card, this.cardWin, m.card)
      box(this.intro, this.introWin, m.intro)
      if (!m.h || !m.card.bottom) this.dirty = true
    }
    return this.m
  }

  update(s: HudState, time: number) {
    const L = this.last
    if (s.ready !== L.ready) setOn(this.ready, (L.ready = s.ready))
    if (s.intro !== L.intro) {
      L.intro = s.intro
      setOn(this.intro, s.intro)
      setRise(this.introTitle, s.intro)
    }
    if (s.shown !== L.shown) {
      const prev = L.shown
      L.shown = s.shown
      setOn(this.card, s.shown >= 0)
      this.slides.forEach((it, k) => {
        setOn(it.root, k === s.shown)
        setRise(it.title, k === s.shown)
      })
      this.bar.forEach((b, k) => setOn(b, k === s.shown, 'is-cur'))
      // a new item types its description out (fast), then settles exact
      if (s.shown >= 0 && prev >= -1 && !this.calm) {
        this.typing = s.shown
        this.typeT0 = time
        this.type(this.slides[s.shown], 0)
      } else if (s.shown >= 0) this.type(this.slides[s.shown], 1)
      // the window pops like a game menu when the item changes
      if (s.shown >= 0 && prev >= 0 && !this.calm && typeof this.cardWin.animate === 'function') {
        this.cardWin.animate(
          [{ transform: 'translate(0, 0)' }, { transform: 'translate(0, -6px)' }, { transform: 'translate(0, 2px)' }, { transform: 'none' }],
          { duration: 240, easing: 'steps(4, end)' },
        )
      }
    }
    if (s.got !== L.got) {
      L.got = s.got
      this.bar.forEach((b, k) => setOn(b, k < s.got, 'is-got'))
    }
    if (s.power !== L.power) setOn(this.power, (L.power = s.power))

    if (this.typing >= 0) {
      const sl = this.slides[this.typing]
      const cps = Math.max(220, sl.text.length / 0.55)
      const f = ((time - this.typeT0) * cps) / sl.text.length
      this.type(sl, f)
      if (f >= 1 || this.typing !== s.shown) {
        this.type(sl, 1)
        this.typing = -1
      }
    }
  }

  /** pin READY? above the player (screen px) */
  placeReady(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    this.ready.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0) translate(-50%, -100%)`
  }

  /** reveal a fraction of a blurb; the hidden rest keeps the layout still */
  private type(sl: Slide, f: number) {
    const n = f >= 1 ? sl.text.length : Math.floor(sl.text.length * Math.max(0, f))
    const a = sl.text.slice(0, n)
    if (sl.typed.textContent !== a) {
      sl.typed.textContent = a
      sl.rest.textContent = sl.text.slice(n)
    }
  }
}
