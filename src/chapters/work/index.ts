import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECTIONS, WORK, workImage, type WorkItem } from '../../content'
import { CHAPTERS } from '../index'
import { P } from '../../kit/pixel'
import { THEMES, fontsReady } from './art'
import { HARK_SCALE, S, WALK_Z, buildHall, cabXOf, drawRadial, type Hall } from './hall'
import { Critter } from './critter'
import { loadPic, whenIdle } from './pics'
import './work.css'

/*
 * LEVEL 2 — ARCADE HALL (Selected work).
 *
 * A row of arcade cabinets at night, one per featured project, on cosmic
 * carpet under tall windows full of Philadelphia skyline and neon. Player 1
 * (a small green critter with big listening ears) walks the row, hopping for
 * coins; at each cabinet it stops to play: the CRT boots from its attract
 * screen into the client's website, the marquee lights chase, a few coins
 * spray out, and a game window opens with the project. The row ends at the
 * house machine, whose HIGH SCORES table lists the other nine sites (scroll
 * moves the menu cursor; the machine previews the selected one). LEVEL CLEAR.
 *
 *   0.000–0.035  READY! (iris opening)
 *   0.035–0.128  wide shot of the hall; "Built to be heard." window; P1 walks in
 *   0.100–0.835  six cabinets (~0.1225 each: walk 30%, then play + window)
 *   0.835–0.955  the high-score machine: table + "Say hello"
 *   0.955–1.000  LEVEL CLEAR! coins burst, the iris closes
 *
 * Everything visible derives from `local`, except game-frame idle (bobs,
 * blinks, chase lights) and one-shot boot effects keyed to arriving.
 */

const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const NF = FEATURED.length
const NR = REST.length

const F0 = 0.1
const F1 = 0.835
const FW = (F1 - F0) / NF
const TRAVEL = 0.3
const H_ARRIVE = 0.862
const ROW0 = 0.868
const ROW1 = 0.948
const CLEAR = 0.955
const WALK0 = 0.035
const START_X = -5.4
const FOV = 30
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

const cabX = (k: number) => cabXOf(k, NF)
const segStart = (k: number) => F0 + FW * Math.min(k, NF)
const arrive = (k: number) => (k < NF ? F0 + FW * (k + TRAVEL) : H_ARRIVE)
const segEnd = (k: number) => (k < NF ? segStart(k + 1) : CLEAR)
const rowAt = (j: number) => ROW0 + ((j + 0.5) * (ROW1 - ROW0)) / NR

/*
 * Player 1 treats the cabinet roofs as platforms: it runs in along the carpet,
 * leaps onto the first machine, then jumps roof to roof (grabbing the coin
 * floating over each gap) and stands on top of each machine, facing us, while
 * it boots.
 */
const csc = (k: number) => (k === NF ? HARK_SCALE : 1)
const roofY = (k: number) => 2.66 * csc(k)
/** where Player 1 stands on roof k (left of centre, clear of the marquee name) */
const standX = (k: number) => cabX(k) - 0.36 * csc(k)
const ROOF_Z = -0.08
const takeoffX = (k: number) => cabX(k) + 0.56 * csc(k)
const landX = (k: number) => cabX(k) - 0.62 * csc(k)
const JUMP_H = 0.62
const INTRO_JUMP_X = -1.35
/** coin over each gap, at the top of the jump; one more over the carpet on the way in */
const COINS: { x: number; y: number; z: number }[] = [
  { x: -2.7, y: 1.3, z: WALK_Z },
  ...Array.from({ length: NF }, (_, k) => {
    const x = (takeoffX(k) + landX(k + 1)) / 2
    return { x, y: (roofY(k) + roofY(k + 1)) / 2 + JUMP_H + 0.42, z: ROOF_Z }
  }),
]
/** walking right, turned three-quarters toward us so the face reads */
const WALK_YAW = Math.PI / 2 - 0.55
const FACE_YAW = 0.32

type PhaseKind = 'intro' | 'walk' | 'dwell' | 'clear'
interface Phase {
  kind: PhaseKind
  k: number
  t: number
}
function phaseOf(l: number): Phase {
  if (l < F0) return { kind: 'intro', k: -1, t: l / F0 }
  for (let k = 0; k <= NF; k++) {
    const s0 = segStart(k)
    const a = arrive(k)
    if (l < a) return { kind: 'walk', k, t: clamp((l - s0) / (a - s0)) }
    if (l < segEnd(k)) return { kind: 'dwell', k, t: clamp((l - a) / (segEnd(k) - a)) }
  }
  return { kind: 'clear', k: NF, t: clamp((l - CLEAR) / (1 - CLEAR)) }
}

/** walking ease: mostly constant speed, soft start and stop */
const walkEase = (t: number) => lerp(t, (1 - Math.cos(Math.PI * t)) / 2, 0.55)

const isPreview = (url: string) => {
  try {
    return /(^|\.)harktest\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const emLast = (s: string) => {
  const parts = s.split(' ')
  if (parts.length < 2) return `<em>${esc(s)}</em>`
  const last = parts.pop()!
  return `${esc(parts.join(' '))} <em>${esc(last)}</em>`
}
const pad = (n: number) => String(n).padStart(2, '0')
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'ST' : n % 10 === 2 && n !== 12 ? 'ND' : n % 10 === 3 && n !== 13 ? 'RD' : 'TH'}`
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface Shot {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
}
const shot = (): Shot => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: FOV })

const _d = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
/** Aim a camera (yaw, pitch) so a w×h subject centred at C fills screen region `reg`. */
function frameTo(out: Shot, C: THREE.Vector3, w: number, h: number, yaw: number, pitch: number, fov: number, reg: Region, W: number, H: number) {
  _d.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  const aspect = W / H
  const tanH = Math.tan((fov * DEG) / 2)
  const fw = Math.max(0.08, (reg.x1 - reg.x0) / W)
  const fh = Math.max(0.08, (reg.y1 - reg.y0) / H)
  const cx = ((reg.x0 + reg.x1) / 2 / W) * 2 - 1
  const cy = 1 - ((reg.y0 + reg.y1) / 2 / H) * 2
  const dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
  const hh = dist * tanH
  const hw = hh * aspect
  _r.crossVectors(_d, UP).normalize()
  _u.crossVectors(_r, _d).normalize()
  out.pos.copy(C).addScaledVector(_d, -dist).addScaledVector(_r, -cx * hw).addScaledVector(_u, -cy * hh)
  out.tgt.copy(out.pos).addScaledVector(_d, dist)
  out.fov = fov
  return out
}

interface Layout {
  key: string
  W: number
  H: number
  portrait: boolean
  safe: Region
  dockR: number
  cardH: number[]
  scoresR: number
  scoresH: number
  introB: number
}

interface PlayerState {
  x: number
  y: number
  z: number
  walking: boolean
  air: boolean
  squash: number
}

interface Card {
  root: HTMLElement
  name: HTMLElement
  typed: HTMLElement
  ghost: HTMLElement
  text: string
  on: boolean
  t0: number
  shown: number
}

class Work implements Chapter {
  id = 'work'
  group = new THREE.Group()
  anchors = WORK.map(w => {
    const k = FEATURED.indexOf(w)
    if (k >= 0) return arrive(k) + (segEnd(k) - arrive(k)) * 0.45
    return rowAt(Math.max(0, REST.indexOf(w)))
  })

  private ctx!: ChapterContext
  private hall!: Hall
  private critter!: Critter
  private mobile = false
  private reduced = false

  // DOM
  private safe!: HTMLElement
  private ready!: HTMLElement
  private intro!: HTMLElement
  private introTitle!: HTMLElement
  private dock!: HTMLElement
  private cards: Card[] = []
  private scoresDock!: HTMLElement
  private scores!: HTMLElement
  private scoresTitle!: HTMLElement
  private rows: HTMLElement[] = []
  private clearEl!: HTMLElement
  private hoverRow = -1
  private selRow = -1

  // layout / camera
  private lay: Layout | null = null
  private layDirty = true
  private a = shot()
  private b = shot()
  private c = shot()
  private tmp = new THREE.Vector3()

  // per-cabinet boot state (time-based, converges to a scroll-derived target)
  private boot: number[] = []
  private bootT0: number[] = []
  private shotTex: (THREE.Texture | null)[] = FEATURED.map(() => null)
  private shotFlip: number[] = FEATURED.map(() => 0)
  private restTex: (THREE.Texture | null)[] = REST.map(() => null)
  private restFlip: number[] = REST.map(() => 0)
  private staticT0 = -10
  private shownRow = -2
  private clearOn = false
  private clearT0 = -10
  private pokeT0 = -10
  private lastBulbKey = ''
  private lastLocal = 0
  private time = 0

  // images
  private queue: (() => Promise<unknown>)[] = []
  private loading = 0
  private streaming = false
  private jobs: (() => void)[] = []
  private idleQueued = false

  // scratch
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private sc = new THREE.Vector3()
  private col = new THREE.Color()
  private ray = new THREE.Raycaster()
  private pl: PlayerState = { x: 0, y: 0, z: 0, walking: false, air: false, squash: 0 }

  async init(ctx: ChapterContext) {
    this.ctx = ctx
    this.mobile = ctx.mobile
    this.reduced = ctx.reducedMotion
    this.buildDom(ctx.stage)
    await nextFrame()

    const names = [...FEATURED.map(w => w.name), 'High Scores']
    this.hall = await buildHall(names, this.mobile, nextFrame)
    this.group.add(this.hall.root)
    this.boot = this.hall.cabs.map(() => 0)
    this.bootT0 = this.hall.cabs.map(() => -10)
    const radial = drawRadial()
    this.critter = new Critter(radial)
    this.group.add(this.critter.group, this.critter.shadow)
    await nextFrame()

    fontsReady().then(() => {
      this.hall.repaint()
      this.layDirty = true
    })
    window.addEventListener('resize', () => (this.layDirty = true))

    // screenshots: the first cabinet now, the rest once the site is revealed
    this.queue = [...FEATURED.map((_, k) => () => this.fetchFeatured(k)), ...REST.map((_, j) => () => this.fetchRest(j))]
    this.pumpLoads(1)
    const go = () => {
      if (this.streaming) return
      this.streaming = true
      this.pumpLoads(2)
    }
    if (document.documentElement.dataset.ready === '1') go()
    else {
      window.addEventListener('hark:reveal', go, { once: true })
      window.setTimeout(go, 12000)
    }
  }

  // ------------------------------------------------------------------ images

  private pumpLoads(max: number) {
    while (this.loading < max && this.queue.length) {
      const job = this.queue.shift()!
      this.loading++
      job().finally(() => {
        this.loading--
        if (this.streaming) this.pumpLoads(2)
      })
    }
  }

  private makeTex(src: ImageBitmap | HTMLImageElement, bitmap: boolean) {
    const tex = new THREE.Texture(src)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.generateMipmaps = false
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    // WebGL ignores UNPACK_FLIP_Y for ImageBitmaps: the shader flips instead
    if (bitmap) tex.flipY = false
    tex.needsUpdate = true
    return tex
  }

  private picSize(): [number, number] {
    return this.mobile ? [384, 240] : [640, 400]
  }

  private fetchFeatured(k: number) {
    const [w, h] = this.picSize()
    return loadPic(workImage(FEATURED[k].id), w, h)
      .then(pic => {
        const tex = this.makeTex(pic.src, pic.bitmap)
        this.addJob(() => {
          this.upload(tex)
          this.shotTex[k] = tex
          this.shotFlip[k] = pic.bitmap ? 1 : 0
        })
      })
      .catch(err => console.warn(`[work] missing screenshot for ${FEATURED[k].id}`, err))
  }

  private fetchRest(j: number) {
    const [w, h] = this.picSize()
    return loadPic(workImage(REST[j].id), w, h)
      .then(pic => {
        const tex = this.makeTex(pic.src, pic.bitmap)
        this.addJob(() => {
          this.upload(tex)
          this.restTex[j] = tex
          this.restFlip[j] = pic.bitmap ? 1 : 0
        })
      })
      .catch(err => console.warn(`[work] missing screenshot for ${REST[j].id}`, err))
  }

  private upload(tex: THREE.Texture) {
    try {
      this.ctx.renderer.initTexture(tex)
    } catch {
      /* uploads on first use instead */
    }
  }

  private addJob(job: () => void) {
    this.jobs.push(job)
    this.pumpJobs()
  }

  private pumpJobs() {
    if (this.idleQueued || !this.jobs.length) return
    this.idleQueued = true
    whenIdle(() => {
      this.idleQueued = false
      const job = this.jobs.shift()
      if (job) {
        try {
          job()
        } catch (err) {
          console.warn('[work] job failed', err)
        }
      }
      this.pumpJobs()
    }, 500)
  }

  // ------------------------------------------------------------------ DOM

  private buildDom(stage: HTMLElement) {
    this.safe = el('div', 'wk-safe', undefined, stage)

    this.ready = el('div', 'wk-ready', undefined, stage)
    this.ready.innerHTML = '<span>Ready!</span>'

    // level title window
    this.intro = el('section', 'wk-intro wk-win hud-panel', undefined, stage)
    const it = el('div', 'wk-tab', undefined, this.intro)
    el('p', 'hud-eyebrow', SECTIONS.work.eyebrow, it)
    const [a, b] = SECTIONS.work.title.split(/ (?=\S+$)/)
    this.introTitle = rise(el('h2', 'hud-title wk-intro-title', undefined, this.intro), `${esc(a)} <em>${esc(b)}</em>`)
    const meta = el('p', 'wk-intro-meta', undefined, this.intro)
    meta.innerHTML = `<span class="hud-label">${WORK.length} sites</span><span class="hud-label">${NF} cabinets</span><span class="hud-label">1 high-score table</span>`

    // one game window per cabinet, docked left (bottom on portrait)
    this.dock = el('div', 'wk-dock', undefined, stage)
    FEATURED.forEach((w, k) => this.cards.push(this.buildCard(this.dock, w, k)))

    // high-score table
    this.scoresDock = el('div', 'wk-dock wk-dock--scores', undefined, stage)
    this.scores = el('section', 'wk-scores wk-win hud-panel', undefined, this.scoresDock)
    const st = el('div', 'wk-tab', undefined, this.scores)
    el('p', 'hud-eyebrow', 'High scores', st)
    const allLive = REST.every(w => !isPreview(w.url))
    const count = WORDS[NR] ?? String(NR)
    this.scoresTitle = rise(
      el('h3', 'hud-h2 wk-scores-title', undefined, this.scores),
      allLive ? `${count} more, <em>all live.</em>` : `${count} <em>more.</em>`,
    )
    const head = el('div', 'wk-thead', undefined, this.scores)
    head.innerHTML = '<span>Rank</span><span>Name</span><span class="wk-th-ind">Industry</span>'
    const list = el('ol', 'wk-rows', undefined, this.scores)
    const rowCols = ['var(--cyan)', 'var(--gold)', 'var(--coral)', 'var(--signal)', '#ff9b3d', 'var(--cream)']
    REST.forEach((w, j) => {
      const li = el('li', '', undefined, list)
      const link = el('a', 'wk-row', undefined, li)
      link.href = w.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.style.setProperty('--c', rowCols[j % rowCols.length])
      const pre = isPreview(w.url)
      link.innerHTML = `<span class="wk-rank">${ordinal(j + 1)}</span><span class="wk-rname">${esc(w.name)}${
        pre ? ' <small>(Preview)</small>' : ''
      }</span><span class="wk-rind">${esc(w.industry)}</span><span class="wk-arrow" aria-hidden="true">↗</span>`
      link.addEventListener('pointerenter', () => (this.hoverRow = j))
      link.addEventListener('pointerleave', () => {
        if (this.hoverRow === j) this.hoverRow = -1
      })
      link.addEventListener('focus', () => (this.hoverRow = j))
      link.addEventListener('blur', () => {
        if (this.hoverRow === j) this.hoverRow = -1
      })
      this.rows.push(li)
    })
    const cta = el('div', 'wk-cta', undefined, this.scores)
    const hello = el('button', 'hud-btn', 'Say hello', cta)
    hello.type = 'button'
    hello.addEventListener('click', () => window.__hark?.land('contact'))
    el('span', 'hud-label wk-cta-note', 'Your site next?', cta)

    // level clear
    this.clearEl = el('div', 'wk-clear', undefined, stage)
    const next = CHAPTERS[CHAPTERS.findIndex(c => c.id === 'work') + 1]
    this.clearEl.innerHTML = `<p class="wk-clear-title">Level clear!</p>${
      next ? `<p class="wk-clear-next hud-label">Next level <span aria-hidden="true">▶</span> ${esc(next.label)}</p>` : ''
    }`

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => (this.layDirty = true))
      for (const c of this.cards) ro.observe(c.root)
      ro.observe(this.scores)
      ro.observe(this.safe)
    }
  }

  private buildCard(parent: HTMLElement, w: WorkItem, k: number): Card {
    const root = el('article', 'wk-card wk-win hud-panel', undefined, parent)
    root.style.setProperty('--accent', THEMES[k].accent)
    const tab = el('div', 'wk-tab', undefined, root)
    el('p', 'hud-eyebrow', `Cab ${pad(k + 1)} / ${pad(NF)}`, tab)
    const pre = isPreview(w.url)
    if (pre) el('span', 'wk-badge', 'Preview', root)
    const name = rise(el('h3', 'hud-h2 wk-name', undefined, root), emLast(w.name))
    el('p', 'hud-label wk-kind', w.industry, root)
    el('hr', 'hud-rule', undefined, root)
    const blurb = el('p', 'hud-body wk-blurb', undefined, root)
    const typed = el('span', 'wk-typed', undefined, blurb)
    const ghost = el('span', 'wk-ghost', w.blurb, blurb)
    const tags = el('ul', 'hud-tags wk-tags', undefined, root)
    for (const t of w.tags) el('li', 'hud-tag', t, tags)
    const cta = el('div', 'wk-cta', undefined, root)
    const a = el('a', 'hud-btn', pre ? 'Preview site ↗' : 'Visit site ↗', cta)
    a.href = w.url
    a.target = '_blank'
    a.rel = 'noopener'
    el('span', 'hud-label wk-host', pre ? 'Preview · pre-launch' : hostOf(w.url), cta)
    el('span', 'wk-more', undefined, root).setAttribute('aria-hidden', 'true')
    return { root, name, typed, ghost, text: w.blurb, on: false, t0: 0, shown: -1 }
  }

  // ------------------------------------------------------------------ layout

  private ensureLayout(f: Frame): Layout {
    const key = `${f.width}x${f.height}`
    if (this.lay && this.lay.key === key && !this.layDirty) return this.lay
    this.layDirty = false
    const W = f.width
    const H = f.height
    const portrait = typeof matchMedia === 'function' ? matchMedia('(max-aspect-ratio: 10/9)').matches : W / H < 1.1
    const s = this.safe.getBoundingClientRect()
    const safe = s.width > 0 ? { x0: s.left, y0: s.top, x1: s.right, y1: s.bottom } : { x0: 24, y0: 90, x1: W - 24, y1: H - 90 }
    const d = this.dock.getBoundingClientRect()
    const sd = this.scoresDock.getBoundingClientRect()
    this.lay = {
      key,
      W,
      H,
      portrait,
      safe,
      dockR: d.width > 0 ? d.right : W * 0.4,
      cardH: this.cards.map(c => c.root.offsetHeight || 320),
      scoresR: sd.width > 0 ? sd.right : W * 0.45,
      scoresH: this.scores.offsetHeight || 480,
      introB: this.intro.offsetTop + this.intro.offsetHeight || H * 0.4,
    }
    return this.lay
  }

  private region(kind: 'card' | 'scores' | 'wide' | 'intro', k: number): Region {
    const L = this.lay!
    const s = L.safe
    if (kind === 'wide') return { ...s }
    if (kind === 'intro') {
      if (L.portrait) return { x0: s.x0 - 10, x1: s.x1 + 10, y0: Math.min(L.introB + 6, L.H * 0.5), y1: s.y1 + 20 }
      return { x0: s.x0 + L.W * 0.06, x1: s.x1 + 10, y0: Math.min(L.introB - L.H * 0.06, L.H * 0.42), y1: s.y1 + 30 }
    }
    if (L.portrait) {
      const below = kind === 'card' ? L.cardH[k] : L.scoresH
      const y1 = Math.max(s.y0 + L.H * 0.16, s.y1 - below - 14)
      return { x0: s.x0 - 8, x1: s.x1 + 8, y0: s.y0 + 4, y1 }
    }
    const right = kind === 'card' ? L.dockR : L.scoresR
    return { x0: right + L.W * 0.03, x1: s.x1, y0: s.y0 - 6, y1: s.y1 + 6 }
  }

  // ------------------------------------------------------------------ shots

  private dwellShot(k: number, drift: number, out: Shot) {
    const L = this.lay!
    const house = k === NF
    const sc = house ? HARK_SCALE : 1
    const port = L.portrait
    // the marquee, the screen and Player 1 standing on the roof
    const yTop = 3.5 * sc
    const yBot = 1.3 * sc
    this.tmp.set(cabX(k) - 0.04, (yTop + yBot) / 2, 0.15 * sc)
    frameTo(out, this.tmp, 1.7 * sc, yTop - yBot, -0.07 + drift * 0.035, 0.12, FOV, this.region(house ? 'scores' : 'card', k), L.W, L.H)
    out.pos.lerp(out.tgt, drift * 0.035)
    return out
  }

  private introShot(u: number, out: Shot) {
    const L = this.lay!
    const port = L.portrait
    this.tmp.set(lerp(1.35, 1.75, u) * S, 1.45, 0.4)
    frameTo(out, this.tmp, port ? 5.4 : 11.5, port ? 3.6 : 3.4, lerp(-0.66, -0.56, u), lerp(0.2, 0.17, u), FOV, this.region('intro', 0), L.W, L.H)
    return out
  }

  /** LEVEL CLEAR: swing round to look back down the whole row, every screen lit */
  private clearShot(out: Shot) {
    const L = this.lay!
    const port = L.portrait
    this.tmp.set(port ? cabX(NF) - 1.0 : cabX(NF) - 2.6, 1.8, 0.3)
    frameTo(out, this.tmp, port ? 4.2 : 8.8, port ? 4.6 : 4.3, 0.5, 0.2, FOV, this.region('wide', 0), L.W, L.H)
    return out
  }

  private travel(a: Shot, b: Shot, t: number, pull: number, out: Shot) {
    const e = ease.inOutCubic(t)
    out.pos.lerpVectors(a.pos, b.pos, e)
    out.tgt.lerpVectors(a.tgt, b.tgt, e)
    out.fov = lerp(a.fov, b.fov, e)
    const bump = Math.sin(Math.PI * t) * pull
    this.v.subVectors(out.pos, out.tgt).normalize()
    out.pos.addScaledVector(this.v, bump)
    out.pos.y += bump * 0.22
    out.tgt.y += bump * 0.12
    return out
  }

  private shotAt(l: number, out: Shot) {
    const ph = phaseOf(l)
    if (ph.kind === 'intro') return this.introShot(ph.t, out)
    if (ph.kind === 'walk') {
      const from = ph.k === 0 ? this.introShot(1, this.a) : this.dwellShot(ph.k - 1, 1, this.a)
      return this.travel(from, this.dwellShot(ph.k, 0, this.b), ph.t, ph.k === 0 ? 0.3 : ph.k === NF ? 2.0 : 1.7, out)
    }
    if (ph.kind === 'dwell') return this.dwellShot(ph.k, ph.t, out)
    return this.travel(this.dwellShot(NF, 1, this.a), this.clearShot(this.b), ease.outQuad(clamp(ph.t / 0.7)), 1.2, out)
  }

  // ------------------------------------------------------------------ player

  /**
   * Player 1's pose along the level, purely from scroll: position, whether its
   * legs are walking, whether it is airborne, and a landing squash (0..1).
   */
  private player(l: number, out: PlayerState): PlayerState {
    out.walking = false
    out.air = false
    out.squash = 0
    out.z = ROOF_Z
    const a0 = arrive(0)
    if (l < a0) {
      const u = clamp((l - WALK0) / (a0 - WALK0))
      const RUN = 0.66
      if (u < RUN) {
        // run in along the carpet (with a hop for the coin)
        out.x = lerp(START_X, INTRO_JUMP_X, walkEase(u / RUN))
        out.y = 0
        out.z = WALK_Z
        out.walking = u > 0
        const c = COINS[0]
        const dx = (out.x - c.x) / 0.62
        if (Math.abs(dx) < 1) out.y = 0.55 * (1 - dx * dx)
      } else {
        // the big leap up onto the first machine
        const v = clamp((u - RUN) / (1 - RUN - 0.08))
        out.x = lerp(INTRO_JUMP_X, standX(0), v)
        out.z = lerp(WALK_Z, ROOF_Z, Math.min(1, v * 1.25))
        out.y = lerp(0, roofY(0), v) + 4 * 1.25 * v * (1 - v)
        out.air = v < 1
        if (v >= 1) out.squash = clamp(1 - (u - (1 - 0.08)) / 0.06)
      }
      return out
    }
    const ph = phaseOf(l)
    if (ph.kind === 'walk') {
      const k = ph.k
      const t = ph.t
      const RUN = 0.16
      const LAND = 0.84
      if (t < RUN) {
        out.x = lerp(standX(k - 1), takeoffX(k - 1), t / RUN)
        out.y = roofY(k - 1)
        out.walking = true
      } else if (t < LAND) {
        const v = (t - RUN) / (LAND - RUN)
        out.x = lerp(takeoffX(k - 1), landX(k), v)
        out.y = lerp(roofY(k - 1), roofY(k), v) + 4 * JUMP_H * v * (1 - v)
        out.air = true
      } else {
        const v = (t - LAND) / (1 - LAND)
        out.x = lerp(landX(k), standX(k), v)
        out.y = roofY(k)
        out.squash = clamp(1 - v / 0.45)
        out.walking = v > 0.3
      }
      return out
    }
    const k = Math.max(0, Math.min(NF, ph.k))
    out.x = standX(k)
    out.y = roofY(k)
    return out
  }

  // ------------------------------------------------------------------ frame

  update(local: number, frame: Frame, ctx: ChapterContext) {
    const l = clamp(local)
    this.lastLocal = l
    const time = frame.time
    this.time = time
    const dt = Math.min(frame.dt, 0.05)
    const reduced = this.reduced || frame.reducedMotion
    const L = this.ensureLayout(frame)
    void L
    const ph = phaseOf(l)
    const hall = this.hall
    const cabs = hall.cabs

    // ---- world + CRT look
    const wp = ctx.world.params
    wp.top = P.void
    wp.bottom = '#241f55'
    wp.stars = 0.85
    wp.key = 2.1
    wp.fill = 0.85
    wp.keyDir.set(-0.35, 0.75, 0.95)

    // ---- which cabinet is being played
    const cur = ph.kind === 'dwell' ? ph.k : ph.kind === 'clear' ? NF : -1
    const curBootT = cur >= 0 ? time - this.bootT0[cur] : 99

    // ---- boots: targets come from scroll; the cabinet being played animates, the rest snap
    for (let k = 0; k < cabs.length; k++) {
      const target = l >= arrive(k) ? 1 : 0
      if (k === cur) {
        if (target === 1 && this.boot[k] === 0 && this.bootT0[k] < time - 0.05) this.bootT0[k] = time
        const rate = target > this.boot[k] ? 1 / 0.85 : 1 / 0.35
        this.boot[k] = target > this.boot[k] ? Math.min(target, this.boot[k] + dt * rate) : Math.max(target, this.boot[k] - dt * rate)
        if (reduced && target === 1) this.boot[k] = Math.max(this.boot[k], Math.min(1, this.boot[k] + dt * 2))
      } else this.boot[k] = target
    }

    // ---- screens
    const sel = this.hoverRow >= 0 ? this.hoverRow : clamp(Math.floor(((l - ROW0) / (ROW1 - ROW0)) * NR), 0, NR - 1)
    for (let k = 0; k < cabs.length; k++) {
      const u = cabs[k].uniforms
      const b = this.boot[k]
      u.uBoot.value = reduced ? (b > 0.5 ? 1 : 0) : Math.floor(b * 16) / 16
      u.uTime.value = time
      u.uBlink.value = reduced ? 0 : 1
      const focus = k === cur
      u.uBright.value = b <= 0 ? 0.78 : focus ? 0.94 : 0.62
      if (k < NF) {
        const tex = this.shotTex[k]
        u.uShot.value = tex
        u.uHasShot.value = tex ? 1 : 0
        u.uFlip.value = this.shotFlip[k]
      } else {
        const tex = this.restTex[sel]
        u.uShot.value = tex
        u.uHasShot.value = tex ? 1 : 0
        u.uFlip.value = this.restFlip[sel]
      }
    }
    // channel switch on the high-score machine
    if (sel !== this.shownRow) {
      if (this.shownRow !== -2 && cur === NF) this.staticT0 = time
      this.shownRow = sel
    }
    const stat = reduced ? 0 : clamp(1 - (time - this.staticT0) / 0.22)
    cabs[NF].uniforms.uStatic.value = stat * 0.85

    // ---- marquee chase lights (game frames)
    const step = Math.floor(time * 12)
    const slow = Math.floor(time * 1.5)
    const bulbKey = `${step}|${slow}|${cur}|${this.boot.map(b => (b > 0.5 ? 1 : 0)).join('')}|${reduced}`
    if (bulbKey !== this.lastBulbKey) {
      this.lastBulbKey = bulbKey
      const per = hall.bulbsPerCab
      for (let k = 0; k < cabs.length; k++) {
        const on = this.boot[k] > 0.5
        for (let i = 0; i < per; i++) {
          let v: number
          if (reduced) v = on ? 1.3 : i % 2 ? 0.9 : 0.4
          else if (k === cur && on) v = (i - step + per * 100) % 4 === 0 ? 1.75 : (i - step + per * 100) % 4 === 1 ? 1.05 : 0.45
          else if (on) v = (i + slow) % 2 ? 1.25 : 0.7
          else v = (i + slow) % 2 ? 0.9 : 0.35
          const c = v > 1.0 ? P.gold : v > 0.6 ? P.orange : P.brown
          this.col.set(c).multiplyScalar(v)
          hall.bulbs.setColorAt(k * per + i, this.col)
        }
      }
      if (hall.bulbs.instanceColor) hall.bulbs.instanceColor.needsUpdate = true
    }

    // ---- floor light pools under each screen
    for (let k = 0; k < cabs.length; k++) {
      const on = this.boot[k]
      const t = THEMES[k]
      if (k === cur && on > 0.5) this.col.set(P.cream).multiplyScalar(0.34)
      else this.col.set(t.accent).multiplyScalar(0.1 + on * 0.1)
      hall.pools.setColorAt(k, this.col)
    }
    if (hall.pools.instanceColor) hall.pools.instanceColor.needsUpdate = true

    // ---- neon flicker (rare, single game-frames)
    for (let i = 0; i < hall.signs.length; i++) {
      const s = hall.signs[i]
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      const off = !reduced && s.flicker && hash(Math.floor(time * 12) + i * 91.3) > 0.975
      mat.color.setScalar(off ? s.base * 0.3 : s.base)
    }

    // ---- Player 1
    const pl = this.player(l, this.pl)
    const cx = { x: pl.x }
    let hop = 0
    let yaw = WALK_YAW
    let perk = 0
    let wiggle = 0
    if (ph.kind === 'dwell') {
      // stop, turn to us on two sprite frames; the ears perk up as the machine boots
      const turn = clamp(ph.t / 0.06)
      yaw = WALK_YAW + (FACE_YAW - WALK_YAW) * (Math.floor(turn * 2.999) / 2)
      perk = clamp(this.boot[ph.k] * 1.4)
      const w = time - this.bootT0[ph.k]
      if (!reduced && w > 0 && w < 0.9) wiggle = Math.sin(w * 34) * 0.16 * (1 - w / 0.9)
      if (!reduced && w > 0.05 && w < 0.45) hop = Math.sin(((w - 0.05) / 0.4) * Math.PI) * 0.32
    } else if (ph.kind === 'clear') {
      yaw = FACE_YAW + 0.25
      perk = 1
      const u = clamp((ph.t - 0.08) / 0.84)
      hop = Math.abs(Math.sin(u * Math.PI * 2)) * 0.7 * (u > 0 && u < 1 ? 1 : 0)
    }
    // poke: click Player 1 to make it hop
    const pk = time - this.pokeT0
    if (pk >= 0 && pk < 0.5) {
      hop = Math.max(hop, Math.sin((pk / 0.5) * Math.PI) * 0.5)
      wiggle += Math.sin(pk * 40) * 0.2 * (1 - pk / 0.5)
    }
    const walkStep = pl.walking ? Math.floor((pl.x - START_X) / 0.15) : -1
    // the floor (or roof) under Player 1, for its shadow
    let ground = 0
    for (let k = 0; k <= NF; k++) if (Math.abs(pl.x - cabX(k)) < 0.72 * csc(k) && pl.z < 0.3) ground = roofY(k)
    this.critter.pose(pl.x, pl.y + hop, pl.z, ground, {
      step: walkStep,
      air: pl.air,
      squash: reduced ? 0 : pl.squash,
      yaw,
      perk,
      idle: reduced ? 0 : ph.kind === 'dwell' ? Math.floor(time * 4) : 0,
      wiggle,
    })

    // ---- coins + sparkles
    let nc = 0
    let ns = 0
    const coins = hall.coins
    const sparks = hall.sparks
    const spinStep = reduced ? 0 : Math.floor(time * 10)
    const putCoin = (x: number, y: number, z: number, rotY: number, s: number) => {
      if (nc >= coins.instanceMatrix.count || s <= 0.001) return
      this.e.set(0, rotY, 0)
      this.q.setFromEuler(this.e)
      this.m4.compose(this.v.set(x, y, z), this.q, this.sc.setScalar(s))
      coins.setMatrixAt(nc++, this.m4)
    }
    const putSpark = (x: number, y: number, z: number, s: number) => {
      if (ns >= sparks.instanceMatrix.count || s <= 0.001) return
      this.m4.compose(this.v.set(x, y, z), this.q.identity(), this.sc.setScalar(s))
      sparks.setMatrixAt(ns++, this.m4)
    }
    COINS.forEach((c, j) => {
      const got = cx.x >= c.x - 0.04
      const bob = reduced ? 0 : Math.floor(Math.sin(time * 3 + j) * 3) * 0.02
      if (!got) putCoin(c.x, c.y + bob, c.z, (spinStep + j * 3) * (Math.PI / 5), 1)
      else {
        const q = clamp((cx.x - c.x) / 0.9)
        if (q < 1) {
          for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + (i * Math.PI) / 2
            const r = 0.12 + q * 0.55
            putSpark(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z, 1 - q)
          }
          // the coin itself zips up and pops
          putCoin(c.x, c.y + q * 0.9, c.z, spinStep * 1.6, 1 - q * q)
        }
      }
    })
    // payout: a few coins spray out when a cabinet boots
    if (!reduced && cur >= 0 && cur < cabs.length && curBootT >= 0 && curBootT < 1.1) {
      const c = cabs[cur]
      // out of the roof's right side, away from Player 1, arcing forward
      for (let i = 0; i < 5; i++) {
        const t = curBootT - i * 0.06
        if (t <= 0) continue
        const vx = 0.35 + i * 0.3
        const px = c.top.x + 0.32 * c.scale + vx * t
        const py = c.top.y + (3.0 + (i % 2) * 0.6) * t - 4.9 * t * t
        const pz = c.top.z + 1.0 * t
        if (py < 0.05) continue
        putCoin(px, py, pz, (spinStep + i * 2) * (Math.PI / 5), Math.min(1, t / 0.06) * 0.85)
      }
    }
    // LEVEL CLEAR: a fountain of coins from the high-score machine (scroll-derived)
    if (ph.kind === 'clear') {
      const c = cabs[NF]
      const n = this.mobile ? 10 : 16
      for (let i = 0; i < n; i++) {
        const t = ph.t * 1.35 - (i % 4) * 0.06
        if (t <= 0) continue
        const a = (i / n) * Math.PI * 2 + 0.3
        const vx = Math.cos(a) * 1.5
        const vy = 3.0 + Math.sin(a) * 1.1
        const py = c.screenCenter.y + vy * t - 4.9 * t * t
        if (py < 0.05) continue
        putCoin(c.screenCenter.x + vx * t, py, c.screenCenter.z + 0.3 + 1.6 * t, (spinStep + i) * (Math.PI / 5), Math.min(1, t / 0.05))
      }
    }
    coins.count = nc
    coins.instanceMatrix.needsUpdate = true
    sparks.count = ns
    sparks.instanceMatrix.needsUpdate = true

    // ---- post
    const pp = ctx.post.params
    pp.pixel = this.mobile ? 2.6 : 3
    // only the intentional glows (> 1) bloom: white highlights and the sites stay crisp
    pp.bloomThreshold = 1.0
    pp.bloomStrength = 0.5
    pp.bloomRadius = 0.32
    pp.vignette = 0.42
    const showingSite = cur >= 0 && this.boot[cur] > 0.6
    pp.palette = showingSite ? 0.8 : 1
    pp.dither = showingSite ? 0.45 : 0.55
    if (!reduced) {
      if (cur >= 0 && curBootT >= 0 && curBootT < 0.12) pp.flash = 0.1 * (1 - curBootT / 0.12)
      if (cur === NF) pp.glitch = stat * 0.25
      const ct = time - this.clearT0
      if (this.clearOn && ct >= 0 && ct < 0.14) pp.flash = Math.max(pp.flash, 0.22 * (1 - ct / 0.14))
    }

    // ---- DOM
    this.updateDom(l, ph, time, reduced, sel)
  }

  private updateDom(l: number, ph: Phase, time: number, reduced: boolean, sel: number) {
    this.ready.classList.toggle('is-on', l < WALK0)
    const introOn = l >= 0.03 && l < 0.128
    this.intro.classList.toggle('is-on', introOn)
    setRise(this.introTitle, introOn)

    const now = performance.now()
    this.cards.forEach((c, k) => {
      const on = l >= arrive(k) + 0.006 && l < segEnd(k) - 0.003
      if (on !== c.on) {
        c.on = on
        c.root.classList.toggle('is-on', on)
        setRise(c.name, on)
        if (on) {
          c.t0 = now + 180
          c.shown = -1
        }
      }
      if (on) {
        const dur = Math.min(900, c.text.length * 11)
        const n = reduced ? c.text.length : Math.round(clamp((now - c.t0) / dur) * c.text.length)
        if (n !== c.shown) {
          c.shown = n
          c.typed.textContent = c.text.slice(0, n)
          c.ghost.textContent = c.text.slice(n)
          c.root.classList.toggle('is-typed', n >= c.text.length)
        }
      }
    })

    const scoresOn = l >= H_ARRIVE + 0.003 && l < CLEAR - 0.002
    this.scores.classList.toggle('is-on', scoresOn)
    setRise(this.scoresTitle, scoresOn)
    if (sel !== this.selRow) {
      if (this.selRow >= 0) this.rows[this.selRow]?.classList.remove('is-sel')
      this.rows[sel]?.classList.add('is-sel')
      this.selRow = sel
    }

    const clearOn = l >= CLEAR + 0.004
    if (clearOn !== this.clearOn) {
      this.clearOn = clearOn
      this.clearEl.classList.toggle('is-on', clearOn)
      if (clearOn) this.clearT0 = time
    }
    void ph
  }

  camera(local: number, frame: Frame, out: CameraPose) {
    if (!this.lay) this.ensureLayout(frame)
    const s = this.shotAt(clamp(local), this.c)
    out.position.copy(s.pos)
    out.target.copy(s.tgt)
    out.fov = s.fov
    out.roll = 0
    out.parallax = 0.1
    // a little screen shake as a cabinet boots / on LEVEL CLEAR
    if (!this.reduced && !frame.reducedMotion) {
      const ph = phaseOf(clamp(local))
      const cur = ph.kind === 'dwell' ? ph.k : -1
      let amp = 0
      if (cur >= 0) {
        const t = this.time - this.bootT0[cur]
        if (t >= 0 && t < 0.28) amp = 0.028 * (1 - t / 0.28)
      }
      const ct = this.time - this.clearT0
      if (this.clearOn && ct >= 0 && ct < 0.35) amp = Math.max(amp, 0.05 * (1 - ct / 0.35))
      if (amp > 0) {
        const f = Math.floor(this.time * 30)
        out.position.x += (hash(f) - 0.5) * 2 * amp
        out.position.y += (hash(f + 17.3) - 0.5) * 2 * amp
      }
    }
  }

  onPointerDown(frame: Frame, ctx: ChapterContext) {
    this.ray.setFromCamera(frame.pointerRaw, ctx.camera)
    if (this.ray.intersectObject(this.critter.hit, false).length) this.pokeT0 = this.time
  }

  onLeave() {
    this.hoverRow = -1
  }
}

export default function create(): Chapter {
  return new Work()
}
