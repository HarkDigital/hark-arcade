import { el, rise } from '../../core/dom'
import { BRAND, CONTACT } from '../../content'

/*
 * The CONTINUE? game window: an RPG-style dialogue box holding the real
 * contact copy. The email is the big arcade button ("INSERT COIN"), with a
 * copy button, the other games (sister sites), back to the title screen and
 * the colophon. Layout is measured on resize (never per frame) so the 3D
 * screen can lay itself out around the window at every viewport.
 */

export interface CssRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Hud {
  stage: HTMLElement
  probe: HTMLElement
  col: HTMLElement
  win: HTMLElement
  title: HTMLElement
  mail: HTMLAnchorElement
  copyBtn: HTMLButtonElement
  /** pointer/focus on the email or copy button */
  hover: boolean
  /** performance-independent: frame.time of the last click on the email button */
  coinAt: number
  copiedAt: number
  dirty: boolean
}

const COIN_SVG =
  '<svg class="ct-coin" viewBox="0 0 9 9" aria-hidden="true" focusable="false" shape-rendering="crispEdges">' +
  '<path fill="#ff9b3d" d="M2 0h5v1h1v1h1v5h-1v1h-1v1h-5v-1h-1v-1h-1v-5h1v-1h1z"/>' +
  '<path fill="#ffd84a" d="M2 1h5v1h1v5h-1v1h-5v-1h-1v-5h1z"/>' +
  '<path fill="#ffffff" d="M3 2h2v1h-1v1h-1z"/>' +
  '<path fill="#ff9b3d" d="M4 3h1v3h-1z"/>' +
  '</svg>'

const ICON_NE =
  '<svg class="ct-ico" viewBox="0 0 7 7" aria-hidden="true" focusable="false" shape-rendering="crispEdges">' +
  '<path d="M2 0h5v5h-1v-4h-4zM5 1h1v1h-1zM4 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM1 5h1v1h-1zM0 6h1v1h-1z"/></svg>'
const ICON_BACK =
  '<svg class="ct-ico ct-ico--back" viewBox="0 0 4 7" aria-hidden="true" focusable="false" shape-rendering="crispEdges">' +
  '<path d="M3 0h1v7h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z"/></svg>'

/** Copy text: async Clipboard API, then a hidden-textarea fallback. */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied / unsupported: fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  active?.focus?.({ preventScroll: true })
  return ok
}

const sfx = (kind: string, level = 1, pitch = 0) =>
  window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind, level, pitch } }))

export function buildHud(stage: HTMLElement, now: () => number): Hud {
  stage.classList.add('is-dark')
  const probe = el('div', 'ct-probe', undefined, stage)
  const col = el('div', 'ct-col', undefined, stage)
  const win = el('div', 'hud-panel ct-win', undefined, col)

  el('p', 'hud-eyebrow ct-eyebrow', CONTACT.eyebrow, win)
  const words = CONTACT.title.split(' ')
  const last = words.pop() ?? ''
  const title = rise(el('h2', 'hud-title ct-title', undefined, win), `${words.join(' ')} <em>${last}</em>`)
  el('p', 'hud-body ct-body', CONTACT.body, win)

  const cta = el('div', 'ct-cta', undefined, win)
  const mail = el('a', 'hud-btn ct-mail', undefined, cta)
  mail.href = CONTACT.href
  mail.innerHTML = `${COIN_SVG}<span class="ct-mail-k">Insert coin<span class="ct-mail-sep" aria-hidden="true"> · </span></span><span class="ct-mail-addr"></span>`
  mail.querySelector('.ct-mail-addr')!.textContent = BRAND.email
  mail.setAttribute('aria-label', `Insert coin: email ${BRAND.email}`)

  const copyBtn = el('button', 'hud-btn hud-btn--ghost ct-copy', undefined, cta)
  copyBtn.type = 'button'
  copyBtn.setAttribute('aria-label', `Copy ${BRAND.email}`)
  copyBtn.innerHTML =
    '<span class="ct-copy-idle">Copy email</span><span class="ct-copy-done" aria-hidden="true">Copied</span><span class="ct-copy-fail" aria-hidden="true">Copy failed</span>'

  el('hr', 'hud-rule ct-rule', undefined, win)

  const games = el('nav', 'ct-games', undefined, win)
  games.setAttribute('aria-label', 'Other games')
  el('p', 'hud-label ct-games-k', 'Other games', games)
  const list = el('ul', 'ct-list', undefined, games)
  const addLink = (label: string, href: string) => {
    const li = el('li', '', undefined, list)
    const a = el('a', 'ct-link', undefined, li)
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    el('span', '', label, a)
    a.insertAdjacentHTML('beforeend', ICON_NE)
    a.setAttribute('aria-label', `${label} (opens in a new tab)`)
  }
  addLink('Classic site', BRAND.classicSite)
  addLink('Orbit', BRAND.orbitSite)
  addLink('Resonance', BRAND.resonanceSite)
  addLink('Press', BRAND.pressSite)
  addLink('Town', BRAND.townSite)
  const li = el('li', 'ct-li-top', undefined, list)
  const top = el('button', 'ct-link ct-top', undefined, li)
  top.type = 'button'
  top.insertAdjacentHTML('beforeend', ICON_BACK)
  el('span', '', 'Back to title', top)
  top.addEventListener('click', e => {
    const hark = window.__hark
    if (!hark) return
    hark.land('hero')
    if (e.detail === 0) hark.engine?.focusChapter('hero')
  })

  const foot = el('p', 'ct-foot', undefined, win)
  const parts = [`© ${new Date().getFullYear()} ${BRAND.name}`, ...BRAND.locale.split(' · ')]
  parts.forEach((p, i) => {
    if (i) foot.append(' · ')
    el('span', 'ct-nw', p, foot)
  })

  // the RPG "more…" cursor in the window's corner
  el('span', 'ct-more', undefined, win).setAttribute('aria-hidden', 'true')

  const hud: Hud = {
    stage,
    probe,
    col,
    win,
    title,
    mail,
    copyBtn,
    hover: false,
    coinAt: -1e9,
    copiedAt: -1e9,
    dirty: true,
  }

  const on = () => {
    if (!hud.hover) sfx('cursor', 0.7, 4)
    hud.hover = true
  }
  const off = () => (hud.hover = false)
  for (const n of [mail, copyBtn]) {
    n.addEventListener('pointerenter', on)
    n.addEventListener('pointerleave', off)
    n.addEventListener('focus', on)
    n.addEventListener('blur', off)
  }
  mail.addEventListener('click', () => {
    hud.coinAt = now()
    sfx('coin', 1)
  })

  let resetT = 0
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(BRAND.email)
    window.clearTimeout(resetT)
    copyBtn.classList.toggle('is-copied', ok)
    copyBtn.classList.toggle('is-failed', !ok)
    if (ok) {
      hud.copiedAt = now()
      sfx('powerup', 0.7)
    }
    resetT = window.setTimeout(() => copyBtn.classList.remove('is-copied', 'is-failed'), 1900)
  })

  const dirty = () => (hud.dirty = true)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(dirty)
    ro.observe(probe)
    ro.observe(win)
  }
  window.addEventListener('resize', dirty)
  document.fonts?.ready.then(dirty).catch(() => {})
  return hud
}

/** a phone turned sideways (the same query as the chrome's short-landscape mode) */
const isShortLandscape = (w: number, h: number) => w > h && h <= 500

/** the window docks under the game screen (else it sits beside it, on the left) */
export const isPortrait = (w: number, h: number) => !isShortLandscape(w, h) && (w < 768 || w / Math.max(1, h) < 0.9)

export interface HudLayout {
  portrait: boolean
  safe: CssRect
  /** the window's box in each mode */
  full: CssRect
  compact: CssRect
  /** compact adds nothing (the fit already folded the pitch away): never swap */
  sameModes: boolean
}

/*
 * Fit steps, applied in order until the window fits its share of the band:
 * 1-4 tighten spacing and type, 5 folds the pitch paragraph away (the copy
 * layer still carries it), 6 drops the colophon. A relax pass then removes
 * any earlier step the window no longer needs, so a short phone keeps its
 * big title and only loses the pitch.
 */
const FIT = ['ct-fit-1', 'ct-fit-2', 'ct-fit-3', 'ct-fit-4', 'ct-fit-5', 'ct-fit-6'] as const

/** CSS px the game screen keeps above a docked window (the CONTINUE? strip) */
const MIN_SCREEN = 130

const rectOf = (n: HTMLElement): CssRect => {
  const r = n.getBoundingClientRect()
  return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }
}

/**
 * Measure the window in both modes (full / compact). Short viewports step the
 * window down (tighter type and spacing, then less copy) until it fits its
 * share of the safe band. Leaves the stage in `mode`.
 */
export function measureHud(hud: Hud, W: number, H: number, mode: 'full' | 'compact'): HudLayout {
  const stage = hud.stage
  const win = hud.win
  const portrait = isPortrait(W, H)
  // no transitions while measuring: the reduced-motion reset gives every
  // property a 0.01ms transition, which would make each read below stale
  stage.classList.add('ct-measuring')
  stage.classList.toggle('ct-portrait', portrait)
  stage.classList.remove(...FIT)
  // measure with the window unclipped and uncapped (max-height would hide
  // the overflow from offsetHeight, so the fit could never trigger)
  const clip = win.style.clipPath
  win.style.clipPath = 'none'
  win.style.maxHeight = 'none'
  const safe = rectOf(hud.probe)
  const band = Math.max(1, safe.y1 - safe.y0)
  // portrait: leave the upper part of the screen to the game
  const limit = portrait ? Math.min(band * (H < 700 ? 0.8 : 0.74), band - MIN_SCREEN) : band
  stage.classList.remove('ct-compact')
  const fits = () => win.offsetHeight <= limit
  let n = 0
  while (n < FIT.length && !fits()) stage.classList.add(FIT[n++])
  // relax: drop the cosmetic steps the later ones made unnecessary
  if (n > 1 && fits())
    for (let i = n - 2; i >= 0; i--) {
      stage.classList.remove(FIT[i])
      if (!fits()) stage.classList.add(FIT[i])
    }
  const full = rectOf(win)
  stage.classList.add('ct-compact')
  const compact = rectOf(win)
  stage.classList.toggle('ct-compact', mode === 'compact')
  win.style.maxHeight = ''
  win.style.clipPath = clip
  stage.classList.remove('ct-measuring')
  const sameModes = Math.abs(compact.y1 - compact.y0 - (full.y1 - full.y0)) < 2
  return { portrait, safe, full, compact, sameModes }
}
