import { el, rise, setRise } from '../../core/dom'
import { PROCESS, STATS } from '../../content'
import { CHAPTERS } from '../index'

/*
 * World-map HUD (visual layer only — the stage is aria-hidden and
 * src/core/srContent.ts carries the accessible copy):
 *   - a title window (How we work / We listen first. Then we build.)
 *   - the level card: WORLD 1-0N, the step's name, its text typed out like
 *     RPG dialogue (settles to the exact copy in < 0.8 s), a 4-node track
 *   - the RESULTS screen: the three stats tally up like an end-of-level
 *     score screen and settle on the exact values
 *   - little map tags under each level node
 *   - the WORLD CLEAR! banner over the closing iris (+ next level)
 */

export interface Band {
  l: number
  r: number
  t: number
  b: number
}

export interface Layout {
  portrait: boolean
  /** screens too short for title + card together: title yields */
  compact: boolean
  /** free screen band for the map while the title (and card) are up */
  follow: Band
  overview: Band
  /** band around the results window (map behind it) */
  full: Band
  gutter: number
  /** window rects (px) — they sit still, so measure once per layout */
  headRect: { left: number; top: number; right: number; bottom: number }
  cardRect: { left: number; top: number; right: number; bottom: number }
}

// 8×8 pixel icons as SVG rects (crisp at any size)
function pix(rows: string[], colors: Record<string, string>, size = 22) {
  const h = rows.length
  const w = rows[0].length
  let rects = ''
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = colors[r[x]]
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`
    }
  })
  return `<svg viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`
}

const G = '#00ff85'
const Y = '#ffd84a'
const C = '#fff4d8'
const K = '#0b0d14'
const M = '#ff5a6e'
const B = '#3a7bff'
const O = '#ff9b3d'

const ICONS = [
  // listen: an ear trumpet with incoming sound
  pix(['........', '.g...yy.', 'g.g.yyyy', '.g.yyoyy', '.g.yyoyy', 'g.g.yyyy', '.g...yy.', '........'], { g: G, y: Y, o: O }),
  // prototype: a blueprint
  pix(['bbbbbbbb', 'bccbcccb', 'bcbbbbcb', 'bcbccbcb', 'bcbccbcb', 'bcbbbbcb', 'bccbcccb', 'bbbbbbbb'], { b: B, c: C }),
  // build: a hammer
  pix(['.yyyyy..', '.yyyyyy.', '.yyyyy..', '...oo...', '...oo...', '...oo...', '...oo...', '...oo...'], { y: '#9aa3c7', o: O }),
  // support: a heart
  pix(['.mm.mm..', 'mcmmmmm.', 'mmmmmmm.', 'mmmmmmm.', '.mmmmm..', '..mmm...', '...m....', '........'], { m: M, c: C }),
]
const STAR = pix(['...y....', '...y....', '..yyy...', 'yyyyyyy.', '.yyyyy..', '..y.y...', '.y...y..', '........'], { y: K }, 14)
const RES_ICONS = [
  // 10 years: a star
  pix(['...yy...', '...yy...', 'yyyyyyyy', '.yyyyyy.', '..yyyy..', '.yy..yy.', '.y....y.', '........'], { y: Y }, 26),
  // $1M+: a coin
  pix(['..yyyy..', '.yooooy.', 'yoyyyyoy', 'yoyooyoy', 'yoyooyoy', 'yoyyyyoy', '.yooooy.', '..yyyy..'], { y: Y, o: O }, 26),
  // 15: a flag
  pix(['cgggggg.', 'cgggggg.', 'cgggggg.', 'cggggg..', 'c.......', 'c.......', 'c.......', 'cc......'], { c: C, g: G }, 26),
]

/** order on the results screen: 10 years, $1M+, 15 */
export const RESULT_STATS = [STATS[0], STATS[2], STATS[1]]

/** count-up frames for each stat that settle on the exact value */
function tallyText(i: number, k: number) {
  const exact = RESULT_STATS[i].value
  if (k >= 1) return exact
  if (i === 0) return `${Math.floor(k * 10)} years`
  if (i === 1) return `$${Math.floor(k * 10) * 100}K`
  return `${Math.floor(k * 15)}`
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function typeSpans(text: string) {
  // words stay unbreakable; chars inside reveal on a stepped delay
  let i = 0
  return text
    .split(/(\s+)/)
    .map(w => {
      if (!w) return ''
      if (/^\s+$/.test(w)) {
        i++
        return ' '
      }
      const chars = [...w].map(ch => `<span class="pm-c" style="--c:${i++}">${ch.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</span>`)
      return `<span class="pm-w">${chars.join('')}</span>`
    })
    .join('')
}

export class MapHud {
  root: HTMLElement
  head: HTMLElement
  private title: HTMLElement
  card: HTMLElement
  private world: HTMLElement
  private pages: HTMLElement[] = []
  private dots: HTMLElement[] = []
  results: HTMLElement
  private rows: { row: HTMLElement; val: HTMLElement }[] = []
  private tagEls: HTMLElement[] = []
  private probe: HTMLElement
  private cur = -2
  private clearMask = -1
  private resOn = false
  private resT0 = 0
  private tally = [-1, -1, -1]
  private headOn = false
  private won: HTMLElement
  private wonOn = false

  constructor(stage: HTMLElement) {
    const root = (this.root = el('div', 'pm', undefined, stage))
    this.probe = el('div', 'pm-probe', undefined, root)

    // ---- title window
    const head = (this.head = el('div', 'pm-head hud-panel', undefined, root))
    el('p', 'hud-eyebrow pm-eyebrow', 'How we work', head)
    this.title = rise(el('h2', 'hud-h2 pm-title', undefined, head), 'We listen first. <br><em>Then we build.</em>')

    // ---- level card
    const card = (this.card = el('div', 'pm-card hud-panel', undefined, root))
    const bar = el('div', 'pm-bar', undefined, card)
    this.world = el('span', 'pm-world', 'WORLD 1-01', bar)
    const stamp = el('span', 'pm-stamp', undefined, bar)
    stamp.innerHTML = `${STAR}<span>CLEAR!</span>`
    const deck = el('div', 'pm-deck', undefined, card)
    PROCESS.forEach((p, i) => {
      const page = el('div', 'pm-page', undefined, deck)
      const name = el('h3', 'pm-name', undefined, page)
      name.innerHTML = `<span class="pm-ico">${ICONS[i]}</span><span>${p.title}</span>`
      const text = el('p', 'pm-text', undefined, page)
      text.innerHTML = typeSpans(p.text)
      this.pages.push(page)
    })
    const track = el('ol', 'pm-track', undefined, card)
    PROCESS.forEach((p, i) => {
      const li = el('li', 'pm-dot', undefined, track)
      const n = el('span', 'pm-dot-n', undefined, li)
      n.innerHTML = `<b>${i + 1}</b>${STAR}`
      el('span', 'pm-dot-l', p.title, li)
      this.dots.push(li)
    })

    // ---- results screen
    const res = (this.results = el('div', 'pm-results hud-panel', undefined, root))
    const top = el('div', 'pm-res-top', undefined, res)
    el('h3', 'pm-res-title', 'Results', top)
    el('span', 'pm-res-kicker', 'World 1 clear!', top)
    el('hr', 'hud-rule pm-res-rule', undefined, res)
    const list = el('ul', 'pm-res-list', undefined, res)
    RESULT_STATS.forEach((s, i) => {
      const row = el('li', 'pm-res-row', undefined, list)
      row.style.setProperty('--r', String(i))
      const ico = el('span', 'pm-res-ico', undefined, row)
      ico.innerHTML = RES_ICONS[i]
      const val = el('span', 'pm-res-val', s.value, row)
      el('span', 'pm-res-lab', s.label, row)
      this.rows.push({ row, val })
    })
    el('hr', 'hud-rule pm-res-rule', undefined, res)
    const foot = el('p', 'pm-res-foot', undefined, res)
    foot.innerHTML = '<span class="pm-blink">&#9654;</span> Scroll to continue'

    // ---- world clear banner (like the arcade hall's LEVEL CLEAR!)
    this.won = el('div', 'pm-won', undefined, root)
    const next = CHAPTERS[CHAPTERS.findIndex(c => c.id === 'process') + 1]
    this.won.innerHTML = `<p class="pm-won-title">World clear!</p>${
      next ? `<p class="pm-won-next hud-label">Next level <span aria-hidden="true">&#9654;</span> ${esc(next.label)}</p>` : ''
    }`

    // ---- map tags (START + 4 levels)
    const tags = el('div', 'pm-tags', undefined, root)
    const names = ['Start', ...PROCESS.map(p => p.title)]
    names.forEach((n, i) => {
      const t = el('div', `pm-tag${i === 0 ? ' pm-tag--start' : ''}`, undefined, tags)
      t.innerHTML = i === 0 ? `<span>${n}</span>` : `<b>${i}</b><i>${STAR}</i><span>${n}</span>`
      this.tagEls.push(t)
    })
  }

  /** Measure the copy and derive the free map bands (px, stage space). */
  layout(W: number, H: number): Layout {
    const pr = this.probe.getBoundingClientRect()
    const gutter = pr.width || 16
    const safeTop = pr.height || 80
    const safeBottom = parseFloat(getComputedStyle(this.probe).marginBottom) || 82
    const portrait = W / Math.max(1, H) < 1.05 || W < 720
    this.root.classList.toggle('is-portrait', portrait)
    const hr = this.head.getBoundingClientRect()
    const cr = this.card.getBoundingClientRect()
    const full: Band = { l: gutter, r: W - gutter, t: safeTop, b: H - safeBottom }
    let follow: Band
    let overview: Band
    let compact = false
    if (!portrait) {
      const col = Math.max(hr.right, cr.right) + 20
      follow = { l: col, r: W - gutter, t: safeTop, b: H - safeBottom }
      overview = { l: hr.right + 20, r: W - gutter, t: safeTop, b: H - safeBottom }
      // short landscape (a phone on its side): the column can't stack both
      // windows, so the title yields while a level card is up
      compact = cr.top < hr.bottom + 8
    } else {
      const gap = cr.top - hr.bottom
      compact = gap < Math.max(210, H * 0.3)
      follow = { l: 0, r: W, t: (compact ? safeTop : hr.bottom) + 10, b: cr.top - 10 }
      overview = { l: 0, r: W, t: hr.bottom + 10, b: H - safeBottom }
    }
    this.root.classList.toggle('is-compact', compact)
    const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    return { portrait, compact, follow, overview, full, gutter, headRect: box(hr), cardRect: box(cr) }
  }

  setHead(on: boolean) {
    if (on !== this.headOn) {
      this.headOn = on
      this.head.classList.toggle('is-on', on)
    }
    setRise(this.title, on)
  }

  /** i = node on the card (-1 hides), mask = bit per cleared node */
  setCard(i: number, mask: number) {
    if (i !== this.cur) {
      const was = this.cur
      this.cur = i
      this.card.classList.toggle('is-on', i >= 0)
      if (i >= 0) {
        this.world.textContent = `WORLD 1-0${i + 1}`
        this.pages.forEach((p, k) => p.classList.toggle('is-on', k === i))
        // re-open the window with a stepped wipe when the level changes
        if (was >= 0) {
          this.card.classList.remove('is-swap')
          void this.card.offsetWidth
          this.card.classList.add('is-swap')
        }
      }
    }
    if (mask !== this.clearMask) {
      this.clearMask = mask
      this.dots.forEach((d, k) => d.classList.toggle('is-clear', !!(mask & (1 << k))))
    }
    for (let k = 0; k < this.dots.length; k++) this.dots[k].classList.toggle('is-cur', k === i && !(mask & (1 << k)))
    this.card.classList.toggle('is-clear', i >= 0 && !!(mask & (1 << i)))
  }

  /** results screen: tally runs ~1.1 s after it opens, then holds exact values */
  setResults(on: boolean, time: number, calm: boolean) {
    if (on !== this.resOn) {
      this.resOn = on
      this.results.classList.toggle('is-on', on)
      this.resT0 = time
      if (!on) this.tally = [-1, -1, -1]
    }
    if (!on) return
    const t = time - this.resT0
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]
      const k = calm ? 1 : Math.max(0, Math.min(1, (t - 0.18 - i * 0.26) / 0.55))
      // step the counter at ~15 fps like a score tally
      const q = k >= 1 ? 1 : Math.floor(k * 12) / 12
      if (q !== this.tally[i]) {
        this.tally[i] = q
        r.val.textContent = tallyText(i, q)
        r.row.classList.toggle('is-done', q >= 1)
        r.row.classList.toggle('is-live', q > 0 || calm)
      }
    }
  }

  setWon(on: boolean) {
    if (on !== this.wonOn) {
      this.wonOn = on
      this.won.classList.toggle('is-on', on)
    }
  }

  /** place map tags: pts in px (null = hidden), state per tag */
  setTags(pts: ({ x: number; y: number } | null)[], state: ('' | 'cur' | 'clear')[]) {
    for (let i = 0; i < this.tagEls.length; i++) {
      const t = this.tagEls[i]
      const p = pts[i]
      if (!p) {
        if (t.style.visibility !== 'hidden') t.style.visibility = 'hidden'
        continue
      }
      t.style.visibility = 'visible'
      t.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0) translate(-50%, 0)`
      const s = state[i]
      if (t.dataset.s !== s) {
        t.dataset.s = s
        t.classList.toggle('is-cur', s === 'cur')
        t.classList.toggle('is-clear', s === 'clear')
      }
    }
  }
}
