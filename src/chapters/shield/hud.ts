import { el, rise, setRise } from '../../core/dom'
import { SECURITY, STATS } from '../../content'
import { P } from '../../kit/pixel'
import { T } from './timeline'

/*
 * The fight's DOM layer (aria-hidden stage; the accessible copy lives in
 * srContent): a fighting-game HP row (YOUR SITE vs MALWARE), a left column
 * (bottom in portrait) whose game window changes with the fight — the red
 * INTRUSION DETECTED log, the "Hacked? Breathe." dialogue, the results card
 * with 24/7 and the CTA — plus WARNING! / YOU WIN! banners over the arena.
 */

const STAT = STATS.find(s => s.value === '24/7') ?? STATS[STATS.length - 1]

function icon(rows: string[], map: Record<string, string>) {
  const w = Math.max(...rows.map(r => r.length))
  const h = rows.length
  let rects = ''
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = map[r[x]]
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`
    }
  })
  return `<svg class="bf-icon" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`
}

const SITE_ICON = icon(
  ['cccccccccc', 'crcycgcccc', 'cccccccccc', 'cnnnnnnnnc', 'cnggnnllnc', 'cngnnnnnnc', 'cnggnnllnc', 'cnnnnnnnnc', 'cccccccccc', '.k......k.'],
  { c: P.cream, r: P.coral, y: P.gold, g: P.signal, n: P.night, l: P.steel, k: P.slate },
)
const BOSS_ICON = icon(
  ['.g......g.', '..c....c..', '..mmmmmm..', '.mmmggmmm.', 'mwvmmmmwvm', 'mmmmmmmmmm', 'mvevevevmm', '.pppppppp.', 'p.p....p.p', 'p..p..p..p'],
  { m: P.magenta, c: P.coral, g: P.gold, w: P.white, v: P.void, e: P.cream, p: P.purple },
)

/** Types text in quickly once shown, then settles to the exact string. */
class Typer {
  private on: HTMLSpanElement
  private off: HTMLSpanElement
  private shown = -1
  private startAt = -1
  constructor(
    node: HTMLElement,
    private text: string,
    private cps = 90,
  ) {
    this.on = el('span', 'bf-tw-on', undefined, node)
    this.off = el('span', 'bf-tw-off', text, node)
  }
  update(visible: boolean, time: number, instant: boolean) {
    if (!visible) {
      this.startAt = -1
      return
    }
    if (this.startAt < 0) this.startAt = time
    const n = instant ? this.text.length : Math.min(this.text.length, Math.floor((time - this.startAt) * this.cps))
    if (n === this.shown) return
    this.shown = n
    this.on.textContent = this.text.slice(0, n)
    this.off.textContent = this.text.slice(n)
  }
}

export class Hud {
  root: HTMLElement
  probe: HTMLElement
  hp: HTMLElement
  col: HTMLElement
  private siteBar: HTMLElement
  private bossBar: HTMLElement
  private siteMeter: HTMLElement
  private bossMeter: HTMLElement
  private siteName: HTMLElement
  private vs: HTMLElement
  private alert: HTMLElement
  private alertTyper: Typer
  private copy: HTMLElement
  private eyebrow: HTMLElement
  private title: HTMLElement
  private dialog: HTMLElement
  private dialogTyper: Typer
  private win: HTMLElement
  private winCard: HTMLElement
  private warning: HTMLElement
  private youwin: HTMLElement
  private last = { site: '', boss: '', ko: false }

  constructor(stage: HTMLElement) {
    const root = (this.root = el('div', 'bf', undefined, stage))
    this.probe = el('div', 'bf-probe', undefined, root)

    // ---------------------------------------------------------------- HP row
    this.hp = el('div', 'bf-hp', undefined, root)
    const mkBar = (cls: string, iconSvg: string, name: string, tag: string) => {
      const bar = el('div', `bf-bar ${cls}`, undefined, this.hp)
      const head = el('div', 'bf-bar-head', undefined, bar)
      head.insertAdjacentHTML('beforeend', iconSvg)
      const nm = el('span', 'bf-name', name, head)
      el('span', 'bf-tag', tag, head)
      const meter = el('div', 'bf-meter', undefined, bar)
      el('b', 'bf-ghost', undefined, meter)
      el('i', 'bf-fill', undefined, meter)
      return { bar, meter, nm }
    }
    const site = mkBar('bf-bar--site', SITE_ICON, 'Your site', '1UP')
    this.vs = el('div', 'bf-vs', 'VS', this.hp)
    const boss = mkBar('bf-bar--boss', BOSS_ICON, 'Malware', 'LV.99')
    this.siteBar = site.bar
    this.siteMeter = site.meter
    this.siteName = site.nm
    this.bossBar = boss.bar
    this.bossMeter = boss.meter

    // ---------------------------------------------------------------- column
    this.col = el('div', 'bf-col', undefined, root)

    this.alert = el('div', 'bf-phase bf-alert hud-panel bf-pop', undefined, this.col)
    const head = el('p', 'bf-alert-head', undefined, this.alert)
    el('span', 'bf-bang', '!', head)
    el('span', 'bf-alert-title', 'Intrusion detected', head)
    const log = el('p', 'bf-log', undefined, this.alert)
    this.alertTyper = new Typer(log, '> MALWARE.EXE attacks!\n> Your site is taking damage…', 70)

    this.copy = el('div', 'bf-phase bf-copy', undefined, this.col)
    this.eyebrow = el('p', 'hud-eyebrow bf-eyebrow bf-pop', SECURITY.eyebrow, this.copy)
    const [w1, w2] = SECURITY.title.split(/\s+(?=\S+$)/)
    this.title = rise(el('h2', 'hud-title bf-title', undefined, this.copy), `${w1 ?? 'Hacked?'}<br><em>${w2 ?? 'Breathe.'}</em>`)
    this.dialog = el('div', 'hud-panel bf-dialog bf-pop', undefined, this.copy)
    el('span', 'bf-speaker', 'Hark', this.dialog)
    const body = el('p', 'hud-body bf-body', undefined, this.dialog)
    this.dialogTyper = new Typer(body, SECURITY.body, 240)
    el('span', 'bf-more', undefined, this.dialog)

    this.win = el('div', 'bf-phase bf-win', undefined, this.col)
    this.winCard = el('div', 'hud-panel bf-card bf-pop', undefined, this.win)
    el('p', 'hud-eyebrow bf-eyebrow', 'Site restored', this.winCard)
    const stat = el('div', 'bf-stat', undefined, this.winCard)
    el('span', 'bf-247', STAT.value, stat)
    el('p', 'hud-body bf-stat-label', STAT.label, stat)
    const cta = el('a', 'hud-btn bf-cta', SECURITY.cta, this.winCard)
    cta.href = SECURITY.href

    // ---------------------------------------------------------------- banners
    this.warning = el('div', 'bf-banner bf-warning', undefined, root)
    const band = el('div', 'bf-warn-band', undefined, this.warning)
    el('b', 'bf-warn-word', 'Warning!', band)
    el('span', 'bf-warn-sub', 'A boss approaches', band)

    this.youwin = el('div', 'bf-banner bf-youwin', undefined, root)
    const word = el('b', 'bf-win-word', undefined, this.youwin)
    ;[...'YOU WIN!'].forEach((ch, i) => {
      const s = el('span', ch === ' ' ? 'bf-sp' : '', ch === ' ' ? ' ' : ch, word)
      s.style.setProperty('--i', String(i))
    })
    el('span', 'bf-win-sub', 'Restored', this.youwin)
  }

  /** place the banners over the arena (px) */
  setArena(cx: number, top: number, w: number, h: number) {
    const s = this.root.style
    s.setProperty('--ax', `${cx.toFixed(1)}px`)
    s.setProperty('--ay', `${top.toFixed(1)}px`)
    s.setProperty('--aw', `${w.toFixed(1)}px`)
    s.setProperty('--ah', `${h.toFixed(1)}px`)
  }

  update(local: number, time: number, instant: boolean, siteHP: number, bossHP: number) {
    const tog = (n: HTMLElement, on: boolean, cls = 'is-in') => {
      if (n.classList.contains(cls) !== on) n.classList.toggle(cls, on)
    }
    tog(this.hp, local > T.hp && local < 0.992)

    const s = siteHP.toFixed(3)
    if (s !== this.last.site) {
      this.last.site = s
      this.siteMeter.style.setProperty('--hp', s)
    }
    const b = bossHP.toFixed(3)
    if (b !== this.last.boss) {
      this.last.boss = b
      this.bossMeter.style.setProperty('--hp', b)
    }
    tog(this.siteBar, siteHP < 0.45, 'is-low')
    tog(this.siteBar, siteHP > 0.999 && local > T.refill[1] - 0.005, 'is-full')
    tog(this.bossBar, bossHP <= 0, 'is-ko')
    const ko = local >= T.boom
    if (ko !== this.last.ko) {
      this.last.ko = ko
      this.vs.textContent = ko ? 'K.O.' : 'VS'
      this.vs.classList.toggle('is-ko', ko)
      this.siteName.textContent = ko ? 'Restored' : 'Your site'
    }

    // phases
    const alertOn = local > T.alert[0] && local < T.alert[1]
    tog(this.alert, alertOn)
    this.alertTyper.update(alertOn, time, instant)

    const copyOn = local > T.title && local < T.body[1]
    tog(this.copy, copyOn)
    tog(this.eyebrow, local > T.title - 0.004 && local < T.body[1])
    setRise(this.title, copyOn)
    const dialogOn = local > T.body[0] && local < T.body[1]
    tog(this.dialog, dialogOn)
    this.dialogTyper.update(dialogOn, time, instant)

    const winOn = local > T.card && local < 0.992
    tog(this.win, winOn)
    tog(this.winCard, winOn)

    tog(this.warning, local > T.warning[0] && local < T.warning[1])
    tog(this.youwin, local > T.win && local < 0.965)
  }
}
