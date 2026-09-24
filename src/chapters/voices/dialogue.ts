import { el } from '../../core/dom'
import { P } from '../../kit/pixel'
import { paintPortrait, type Look } from './folk'

/*
 * The classic RPG dialogue window: a name plate tab (speaker + company), a
 * pixel portrait whose mouth flaps while the line types out, the quote typed
 * character by character (settling to the exact text in under ~0.8s), and a
 * blinking ▼ once the line is complete. A quest tracker tab shows which of the
 * eight voices you've heard; each heart is a button that walks you to that
 * villager.
 *
 * Every quote is laid out in the same grid cell (only one visible), so the
 * window keeps one height for all eight and never jumps. Typing reveals a
 * prefix and hides the rest in place, so words never reflow mid-line.
 */

export interface Line {
  quote: string
  name: string
  company: string
}

/** window unfold / fold (s), must match voices.css */
const OPEN_T = 0.16
const GAP_T = 0.1
/** a line that has opened stays up at least this long before a neighbour replaces it */
const MIN_UP = 0.9
const NONE = -2

export class Dialogue {
  root: HTMLDivElement
  private win: HTMLDivElement
  private who: HTMLSpanElement
  private co: HTMLSpanElement
  private count: HTMLSpanElement
  private face: HTMLCanvasElement
  private fctx: CanvasRenderingContext2D
  private frames: HTMLCanvasElement[] = []
  private quotes: { p: HTMLParagraphElement; typed: HTMLSpanElement; rest: HTMLSpanElement; text: string; n: number }[] = []
  private pips: HTMLButtonElement[] = []

  /** index on screen (-1 = closed) */
  shown = -1
  private upAt = -10
  private typeAt = -10
  private pendingAt = -1
  /** line waiting to open after the fold (NONE = nothing queued) */
  private pending = NONE
  private mouth = -1
  private portrait = -1
  private heard = -1
  /** the line currently typing (for the villager's talking bob), -1 otherwise */
  typing = -1

  constructor(stage: HTMLElement, lines: Line[], looks: Look[], onPip: (i: number) => void) {
    this.root = el('div', 'vo-dlg', undefined, stage)
    const tab = el('div', 'vo-dlg-tab', undefined, this.root)
    this.who = el('span', 'vo-dlg-who', '', tab)
    this.co = el('span', 'vo-dlg-co', '', tab)

    const track = el('div', 'vo-dlg-track', undefined, this.root)
    this.count = el('span', 'vo-dlg-count', '', track)
    const hearts = el('span', 'vo-dlg-hearts', undefined, track)
    lines.forEach((l, i) => {
      const b = el('button', 'vo-pip', undefined, hearts) as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('aria-label', `${l.name}, ${l.company}`)
      b.title = l.name
      b.addEventListener('click', () => onPip(i))
      this.pips.push(b)
    })

    this.win = el('div', 'vo-dlg-win hud-panel', undefined, this.root)
    const fw = el('div', 'vo-dlg-face', undefined, this.win)
    this.face = el('canvas', '', undefined, fw)
    this.face.width = 20
    this.face.height = 20
    this.fctx = this.face.getContext('2d')!
    // pre-paint both mouth frames of every portrait
    for (const look of looks)
      for (const open of [false, true]) {
        const c = document.createElement('canvas')
        c.width = c.height = 20
        paintPortrait(c.getContext('2d')!, look, open)
        this.frames.push(c)
      }
    const text = el('div', 'vo-dlg-text', undefined, this.win)
    lines.forEach(l => {
      const p = el('p', 'vo-q hud-quote', undefined, text)
      const typed = el('span', 'vo-q-typed', '', p)
      const rest = el('span', 'vo-q-rest', l.quote, p)
      this.quotes.push({ p, typed, rest, text: l.quote, n: -1 })
    })
    el('span', 'vo-dlg-next', '▼', this.win).setAttribute('aria-hidden', 'true')
    this.lines = lines
  }
  private lines: Line[]

  /** layout height of the whole window incl. its tabs (stable across lines) */
  get height() {
    return this.root.offsetHeight
  }

  /** force everything closed (chapter left) */
  reset() {
    this.close()
    this.shown = -1
    this.pending = NONE
    this.pendingAt = -1
    this.typing = -1
  }

  private close() {
    this.root.classList.remove('is-open', 'is-done')
    this.typing = -1
  }

  private open(i: number, now: number) {
    const l = this.lines[i]
    this.shown = i
    this.upAt = now
    this.typeAt = now + OPEN_T
    this.who.textContent = l.name
    this.co.textContent = l.company
    this.count.textContent = `${i + 1}/${this.lines.length}`
    for (let j = 0; j < this.quotes.length; j++) {
      const q = this.quotes[j]
      q.p.classList.toggle('is-on', j === i)
    }
    const q = this.quotes[i]
    q.n = -1
    this.root.classList.add('is-open')
    this.root.classList.remove('is-done')
    this.portrait = -1
  }

  /**
   * `want`: the line the scroll position asks for (-1 = none). Lines swap
   * through a short close/open; a line that just opened is held briefly so a
   * brisk scroll never flickers it, but real jumps go straight there.
   */
  update(want: number, now: number, calm: boolean) {
    const queued = this.pending !== NONE ? this.pending : this.shown
    if (want !== queued) {
      const up = now - this.upAt
      const neighbour = this.shown >= 0 && (want < 0 || Math.abs(want - this.shown) === 1)
      if (!(neighbour && up < MIN_UP)) {
        const had = this.shown >= 0
        if (had) this.close()
        this.shown = -1
        this.pending = want >= 0 ? want : NONE
        this.pendingAt = want >= 0 ? now + (had ? OPEN_T * 0.6 + GAP_T : 0) : -1
      }
    }
    if (this.pending !== NONE && now >= this.pendingAt) {
      this.open(this.pending, now)
      this.pending = NONE
    }

    // typewriter
    const i = this.shown
    this.typing = -1
    if (i >= 0) {
      const q = this.quotes[i]
      const len = q.text.length
      const dur = Math.min(0.78, Math.max(0.45, len / 280))
      const t = (now - this.typeAt) / dur
      const n = calm ? len : Math.max(0, Math.min(len, Math.floor(t * len)))
      if (n !== q.n) {
        q.n = n
        // cut at a code-point boundary
        let cut = n
        if (cut > 0 && cut < len && /[\uDC00-\uDFFF]/.test(q.text[cut])) cut++
        q.typed.textContent = q.text.slice(0, cut)
        q.rest.textContent = q.text.slice(cut)
        if (n >= len) this.root.classList.add('is-done')
      }
      if (n < len) this.typing = i
      // mouth flaps at 10 fps while the line types
      const mouth = n < len && !calm ? Math.floor(now * 10) % 2 : 0
      if (mouth !== this.mouth || this.portrait !== i) {
        this.mouth = mouth
        this.portrait = i
        this.fctx.clearRect(0, 0, 20, 20)
        this.fctx.drawImage(this.frames[i * 2 + mouth], 0, 0)
      }
    }
  }

  /** hearts: voices before `current` are heard, `current` is the one on screen */
  setProgress(current: number) {
    if (current === this.heard) return
    this.heard = current
    this.pips.forEach((p, j) => {
      p.classList.toggle('is-heard', j < current)
      p.classList.toggle('is-now', j === current)
    })
  }
}

/** a tiny pixel heart as a data URL (for the tracker pips) */
export function heartURL(fill: string, edge: string = P.void) {
  const rows = ['.kk.kk.', 'kffkffk', 'kfffffk', 'kfffffk', '.kfffk.', '..kfk..', '...k...']
  const c = document.createElement('canvas')
  c.width = 7
  c.height = 7
  const x = c.getContext('2d')!
  rows.forEach((r, y) => {
    for (let i = 0; i < r.length; i++) {
      const ch = r[i]
      if (ch === '.') continue
      x.fillStyle = ch === 'k' ? edge : fill
      x.fillRect(i, y, 1, 1)
    }
  })
  return c.toDataURL()
}
