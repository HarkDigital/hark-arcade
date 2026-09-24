import { BRAND, MICROCOPY } from '../../content'
import { el, rise, setRise } from '../../core/dom'
import { isInsideLogo, logoParts } from '../../logo/logo'
import { P } from '../../kit/pixel'
import type { Slots } from './layout'

/*
 * The hero's DOM layer (inside the aria-hidden stage; the accessible copy is
 * core/srContent):
 *   - TITLE CARD: 'HARK DIGITAL' plate under the logo, a blinking PRESS START
 *     (a real button: it plays the intro run and lands on the menu), the
 *     scroll hint and the © credit line
 *   - PLAYER 1: an RPG dialogue window (pixel portrait of the mark) that
 *     types the manifesto and settles on the exact text
 *   - PAYOFF: the headline + a game menu (▶ See the work / Start a project)
 *   - READY?
 * Two invisible "slots" mark where the 3D logo should sit on the title card
 * and on the payoff; CSS lays them out, the chapter measures them on resize
 * and places the mark to fill them.
 */

const YEAR = (BRAND.locale.match(/\d{4}/) ?? ['2016'])[0]
const CITY = (BRAND.locale.split('·')[0] ?? '').trim()
export const CREDIT = `© ${YEAR} ${BRAND.name} · ${CITY}`.toUpperCase()

/** layout box of `node` relative to `root` (ignores transforms, so stepped pops don't skew it) */
function boxIn(node: HTMLElement, root: HTMLElement) {
  let x = 0
  let y = 0
  let n: HTMLElement | null = node
  while (n && n !== root) {
    x += n.offsetLeft
    y += n.offsetTop
    n = n.offsetParent as HTMLElement | null
  }
  return { l: x, t: y, r: x + node.offsetWidth, b: y + node.offsetHeight }
}

/** A tiny pixel portrait of the mark for the dialogue window. */
function portrait(size = 20): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const diamond = logoParts().diamond
  const inside: boolean[] = []
  const gem: boolean[] = []
  const span = 1.16
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size - 0.5) * span
      const py = (0.5 - (y + 0.5) / size) * span
      inside.push(isInsideLogo(px, py))
      gem.push(isInsideLogo(px, py, diamond))
    }
  }
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && inside[y * size + x]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (inside[i]) {
        ctx.fillStyle = gem[i] ? P.cyan : P.signal
        // one-pixel shade on the lower-right edge
        if (!gem[i] && (!at(x + 1, y) || !at(x, y + 1))) ctx.fillStyle = P.green
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        ctx.fillStyle = P.void
      } else continue
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return cv
}

export interface HeroUIState {
  local: number
  /** 0..1 intro progress (1 = done / skipped) */
  intro: number
  /** seconds the dialogue window has been up (drives the fast typewriter) */
  dialogT: number
  time: number
}

export class HeroUI {
  root: HTMLDivElement
  private card: HTMLElement
  private slotTitle: HTMLElement
  private word: HTMLElement
  private start: HTMLButtonElement
  private hint: HTMLElement
  private credit: HTMLElement
  private dialog: HTMLElement
  private typed: HTMLElement
  private rest: HTMLElement
  private next: HTMLElement
  private pay: HTMLElement
  private slotPay: HTMLElement
  private title: HTMLElement
  private menu: HTMLElement
  private items: HTMLElement[] = []
  private ready: HTMLElement
  private text = BRAND.manifesto
  private shownChars = -1
  slots: Slots = {
    title: { sx: 0, sy: 0.3, frac: 0.36 },
    pay: { sx: 0.4, sy: 0.05, frac: 0.44 },
    portrait: false,
  }
  onStart: () => void = () => {}

  constructor(stage: HTMLElement) {
    this.root = el('div', 'hero-root', undefined, stage)

    // ---- title card
    this.card = el('div', 'hero-card', undefined, this.root)
    this.slotTitle = el('div', 'hero-slot hero-slot--title', undefined, this.card)
    this.word = el('p', 'hero-word', undefined, this.card)
    this.word.innerHTML = '<span>Hark</span><span>Digital</span>'
    this.start = el('button', 'hero-start', 'Press Start', this.card)
    this.start.type = 'button'
    this.start.addEventListener('click', () => this.onStart())
    this.hint = el('p', 'hero-hint', undefined, this.card)
    el('span', 'hero-hint__arrow', undefined, this.hint)
    el('span', 'hero-hint__label', MICROCOPY.scrollHint, this.hint)
    this.credit = el('p', 'hero-credit', CREDIT, this.root)

    // ---- PLAYER 1 dialogue window
    this.dialog = el('div', 'hero-dialog hud-panel', undefined, this.root)
    const face = el('div', 'hero-dialog__face', undefined, this.dialog)
    face.appendChild(portrait())
    el('p', 'hud-eyebrow hero-dialog__who', MICROCOPY.signalEyebrow, this.dialog)
    const txt = el('p', 'hero-dialog__text', undefined, this.dialog)
    this.typed = el('span', 'hero-dialog__typed', undefined, txt)
    this.rest = el('span', 'hero-dialog__rest', this.text, txt)
    this.next = el('span', 'hero-dialog__next', undefined, this.dialog)

    // ---- payoff: headline + game menu
    this.pay = el('div', 'hero-pay', undefined, this.root)
    const copy = el('div', 'hero-pay__copy', undefined, this.pay)
    this.title = rise(el('p', 'hud-title hero-title', undefined, copy), 'Make the internet <em>listen.</em>')
    this.menu = el('nav', 'hero-menu hud-panel', undefined, copy)
    const work = el('button', 'hero-menu__item is-sel', undefined, this.menu)
    work.type = 'button'
    el('span', 'hero-menu__cur', undefined, work)
    el('span', 'hero-menu__label', 'See the work', work)
    work.addEventListener('click', () => window.__hark?.land('work'))
    const contact = el('a', 'hero-menu__item', undefined, this.menu)
    contact.href = '#contact'
    el('span', 'hero-menu__cur', undefined, contact)
    el('span', 'hero-menu__label', 'Start a project', contact)
    contact.addEventListener('click', e => {
      e.preventDefault()
      window.__hark?.land('contact')
    })
    this.items = [work, contact]
    // the menu cursor follows the pointer / focus, like a game menu
    for (const it of this.items) {
      const sel = () => this.items.forEach(o => o.classList.toggle('is-sel', o === it))
      it.addEventListener('pointerenter', sel)
      it.addEventListener('focus', sel)
    }
    this.menu.addEventListener('pointerleave', () => this.items.forEach((o, i) => o.classList.toggle('is-sel', i === 0)))
    this.slotPay = el('div', 'hero-slot hero-slot--pay', undefined, this.pay)

    this.ready = el('p', 'hero-ready', 'Ready?', this.root)

    this.measure()
    window.addEventListener('resize', () => this.measure())
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.measure())
      ro.observe(this.root)
      ro.observe(this.card)
      ro.observe(this.pay)
    }
    document.fonts?.ready.then(() => this.measure())
  }

  /** Measure the logo slots (resize / reflow only — never per frame). */
  measure() {
    const W = this.root.clientWidth
    const H = this.root.clientHeight
    if (W < 10 || H < 10) return
    const port = W / H < 0.95
    if (this.root.classList.contains('is-port') !== port) this.root.classList.toggle('is-port', port)
    this.slots.portrait = port
    const slot = (n: HTMLElement) => {
      const b = boxIn(n, this.root)
      const cx = (b.l + b.r) / 2
      const cy = (b.t + b.b) / 2
      return { sx: (cx / W) * 2 - 1, sy: 1 - (cy / H) * 2, frac: Math.max(0.05, (b.b - b.t) / H) }
    }
    this.slots.title = slot(this.slotTitle)
    this.slots.pay = slot(this.slotPay)
  }

  update(s: HeroUIState) {
    const { local, intro } = s
    const cls = (n: HTMLElement, c: string, on: boolean) => {
      if (n.classList.contains(c) !== on) n.classList.toggle(c, on)
    }
    // title card
    const cardOn = local < 0.1
    cls(this.word, 'is-in', intro > 0.45 && local < 0.12)
    cls(this.start, 'is-in', (intro > 0.62 && local < 0.1) || (local >= 0.1 && local < 0.16))
    cls(this.start, 'is-pressed', local >= 0.1)
    cls(this.hint, 'is-in', intro > 0.8 && local < 0.06)
    cls(this.credit, 'is-in', intro > 0.55 && cardOn)

    // dialogue: typewriter settles fast — whichever is further along of
    // scroll-driven and time-driven typing, so a jump never shows it half-done
    const dOn = local > 0.215 && local < 0.555
    cls(this.dialog, 'is-in', dOn)
    const n = this.text.length
    const byScroll = Math.floor(n * Math.min(1, Math.max(0, (local - 0.22) / 0.1)))
    const byTime = Math.floor(s.dialogT * 90)
    const chars = dOn ? Math.min(n, Math.max(byScroll, byTime)) : 0
    if (chars !== this.shownChars) {
      this.shownChars = chars
      this.typed.textContent = this.text.slice(0, chars)
      this.rest.textContent = this.text.slice(chars)
    }
    cls(this.next, 'is-in', dOn && chars >= n)

    // payoff
    const payOn = local > 0.68 && local < 0.93
    cls(this.pay, 'is-in', payOn)
    setRise(this.title, payOn)
    cls(this.ready, 'is-in', local >= 0.93)
  }
}
