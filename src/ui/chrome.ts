import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, holdScene, onScenePause, releaseScene, sceneHeld } from './scene'
import { ICON, pixelMark } from './pixelart'

/*
 * Persistent chrome: the arcade HUD over the CRT.
 *
 *   top-left      the brand window: the Hark mark as pixel art, the real
 *                 "Hark.Digital" wordmark (its dot is a green pixel LED) and a
 *                 "Concept · Arcade" tag (-> back to the title screen); beside
 *                 it a decorative 1UP score that counts up with the story
 *                 (000000 -> 999999; it is a game score, not a business stat)
 *   top-right     Work · Services · Contact as game-menu items (a ▶ cursor
 *                 jumps to the one under the pointer / focus) and an arcade
 *                 "Start a project" button with a coin in it. <= 900px: a
 *                 "Menu" button opens the PAUSE MENU (a real modal dialog: the
 *                 game freezes behind it, level select, Start a project,
 *                 sound, email)
 *   bottom-left   Sound: Off / On with a pixel speaker (waves animate when on)
 *   bottom-right  the level readout "LEVEL 3 · Power-Ups · Services", seven
 *                 clickable level pips (cleared / current / locked; the current
 *                 one charges up with progress through the level) and three
 *                 decorative hearts
 *
 * API: createChrome(root, engine, sound) -> { update(frame, state) }
 */

const NAV = [
  { id: 'work', label: 'Work' },
  { id: 'services', label: 'Services' },
  { id: 'contact', label: 'Contact' },
]

/** Plain business names shown beside each level's game name. */
const PLAIN: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const pad6 = (n: number) => String(Math.max(0, Math.min(999999, Math.floor(n)))).padStart(6, '0')

/** the pause icon for the Menu button (two bars) and the resume triangle */
const PAUSE_IC = `<svg class="px px-pause" viewBox="0 0 7 7" width="7" height="7" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 0h2v7H0zM5 0h2v7H5z"/></svg>`

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const plainOf = (id: string, fallback: string) => PLAIN[id] ?? fallback
  const nav = NAV.filter(n => indexOf(n.id) >= 0)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // the rotate card and the pause menu both freeze the game (scene.ts)
  bindScene(engine)
  mountRotateGate(shown => (engine.paused = shown || sceneHeld()))
  onScenePause.push(paused => {
    if (paused) sound.hush()
  })
  // dev-only handle for audio checks in headless tests
  if (import.meta.env.DEV) (window as unknown as { __harkSound?: Sound }).__harkSound = sound

  // ---------------------------------------------------------------- markup

  const brandInner = `<span class="ch-mark">${pixelMark(20, { cls: 'ch-mark-px' })}</span>
        <span class="ch-brand-text" aria-hidden="true">
          <span class="ch-word">${WORDMARK}</span>
          <span class="ch-sub">${CONCEPT_TAG}</span>
        </span>`

  const navLinks = nav
    .map(
      n =>
        `<li><a class="ch-link" href="#${n.id}" data-goto="${n.id}"><span class="ch-cur" aria-hidden="true">${ICON.cursor()}</span><span class="ch-link-t">${n.label}</span></a></li>`,
    )
    .join('')

  const pips = slots
    .map((s, i) => {
      const plain = plainOf(s.def.id, s.def.label)
      return `<li><button class="ch-pip" type="button" data-goto="${s.def.id}" data-i="${i}" aria-label="Level ${i + 1} of ${total}: ${esc(plain)} (${esc(s.def.label)})"><span class="ch-pip-b" aria-hidden="true"><i class="ch-pip-fill"></i><span class="ch-pip-n">${i + 1}</span></span></button></li>`
    })
    .join('')

  const menuItems = slots
    .map((s, i) => {
      const plain = plainOf(s.def.id, s.def.label)
      return `<li><a class="ch-ml" href="#${s.def.id}" data-goto="${s.def.id}" aria-label="${esc(plain)}, level ${i + 1}: ${esc(s.def.label)}">
        <span class="ch-ml-cur" aria-hidden="true">${ICON.cursor()}</span>
        <span class="ch-ml-n" aria-hidden="true">${i + 1}</span>
        <span class="ch-ml-name" aria-hidden="true">${esc(plain)}</span>
        <span class="ch-ml-game" aria-hidden="true">${esc(s.def.label)}</span>
        <span class="ch-ml-here" aria-hidden="true">Now</span>
      </a></li>`
    })
    .join('')

  const soundInner = (cls: string) =>
    `<span class="${cls}-ic" aria-hidden="true">${ICON.speaker()}</span><span class="${cls}-txt">${MICROCOPY.audio}<span aria-hidden="true">:</span> <span class="ch-sound-state" aria-hidden="true">${MICROCOPY.audioOff}</span></span>`

  const hearts = [0, 1, 2].map(i => `<i style="--i:${i}">${ICON.heart()}</i>`).join('')

  root.innerHTML = `
  <div class="chrome">
    <header class="ch-top">
      <div class="ch-left">
        <a class="ch-brand ch-win" href="#hero" data-goto="hero" aria-label="${esc(BRAND.name)}, back to start">
          ${brandInner}
        </a>
        <p class="ch-score" aria-hidden="true"><span class="ch-score-k">1UP</span><span class="ch-score-v">${'<i>0</i>'.repeat(6)}</span></p>
      </div>
      <nav class="ch-nav" aria-label="Primary">
        <ul class="ch-links ch-win">${navLinks}</ul>
        <a class="hud-btn ch-cta" href="#contact" data-goto="contact" data-focus><span class="ch-coin" aria-hidden="true">${ICON.coin()}</span><span>Start a project</span></a>
      </nav>
      <button class="ch-menu-btn ch-win" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog">
        <span class="ch-menu-ic" aria-hidden="true">${PAUSE_IC}</span><span class="ch-menu-btn-txt">Menu</span>
      </button>
    </header>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-labelledby="ch-menu-title" data-lenis-prevent hidden>
      <div class="ch-menu-top">
        <span class="ch-brand ch-win ch-menu-brand" aria-hidden="true">${brandInner}</span>
        <button class="ch-menu-btn ch-win ch-menu-close" type="button" aria-label="Resume (close menu)">
          <span class="ch-menu-ic" aria-hidden="true">${ICON.cursor()}</span><span class="ch-menu-btn-txt" aria-hidden="true">Resume</span>
        </button>
      </div>
      <div class="ch-menu-body">
        <h2 class="ch-paused" id="ch-menu-title">Paused</h2>
        <nav class="ch-menu-win" aria-label="Levels">
          <p class="ch-menu-k" aria-hidden="true"><span>Level select</span><span class="ch-menu-lives">${hearts}</span></p>
          <ol class="ch-menu-list">${menuItems}</ol>
        </nav>
        <div class="ch-menu-foot">
          <a class="hud-btn ch-menu-cta" href="#contact" data-goto="contact"><span class="ch-coin" aria-hidden="true">${ICON.coin()}</span><span>Start a project</span></a>
          <button class="ch-sound ch-menu-sound ch-win" type="button" data-sound-toggle aria-pressed="false">${soundInner('ch-sound')}</button>
        </div>
        <p class="ch-menu-mail"><a href="mailto:${BRAND.email}">${BRAND.email}</a></p>
      </div>
    </div>

    <div class="ch-bottom">
      <button class="ch-sound ch-win" type="button" data-sound-toggle aria-pressed="false">${soundInner('ch-sound')}</button>

      <div class="ch-level ch-win">
        <p class="ch-read" aria-hidden="true">
          <span class="ch-lv"><span class="ch-lv-k">Level</span> <b class="ch-lv-n">1</b></span>
          <span class="ch-read-name"><span class="ch-game"></span><span class="ch-plain"></span></span>
          <span class="ch-lives">${hearts}</span>
        </p>
        <nav class="ch-pips" aria-label="Levels"><ol>${pips}</ol></nav>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const chrome = $('.chrome')
  const soundBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')]
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const menu = $('.ch-menu')
  const pipEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-pip')]
  const pipFills = pipEls.map(p => p.querySelector<HTMLElement>('.ch-pip-fill')!)
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const lvKey = $('.ch-lv-k')
  const lvNum = $('.ch-lv-n')
  const gameEl = $('.ch-game')
  const plainEl = $('.ch-plain')
  const nameEl = $('.ch-read-name')
  const scoreDigits = [...root.querySelectorAll<HTMLElement>('.ch-score-v i')]
  const scoreBox = $('.ch-score')
  const livesBox = $('.ch-level .ch-lives')
  /** restart a one-shot CSS cue (a few blinks / hops, never endless) */
  const cueAnim = (el: HTMLElement, cls: string) => {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  }

  // header-first tab order: the chrome comes before the active chapter's content
  const stagesEl = document.getElementById('stages')
  if (
    stagesEl &&
    stagesEl.parentNode === root.parentNode &&
    root.compareDocumentPosition(stagesEl) & Node.DOCUMENT_POSITION_PRECEDING
  ) {
    stagesEl.parentNode!.insertBefore(root, stagesEl)
  }

  // ---------------------------------------------------------------- navigation

  // neighbours scroll, long jumps take the iris cut (Engine.land)
  const go = (id: string) => {
    if (indexOf(id) >= 0) engine.land(id)
  }

  root.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-goto]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.goto!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(a.matches('.ch-cta, .ch-menu-cta') ? 4 : Math.max(0, indexOf(id)))
    go(id)
    // menu links always hand focus on (the menu they lived in is gone); the
    // top nav, CTA, brand and pips do it for keyboard activation (click.detail 0)
    if (fromMenu || (e.detail === 0 && (a.matches('.ch-link, .ch-pip, .ch-brand') || a.hasAttribute('data-focus'))))
      engine.focusChapter(id)
  })

  // the menu cursor "tick" on hover (mouse / pen only) and keyboard focus
  root.querySelectorAll<HTMLElement>('.ch-link, .ch-cta, .ch-pip, .ch-brand, .ch-ml, .ch-menu-cta').forEach((node, i) => {
    node.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType !== 'touch') sound.sfx('cursor', 1, i % 5)
    })
    node.addEventListener('focus', () => sound.sfx('cursor', 1, i % 5))
  })

  // ------------------------------------------------------------- level readout

  let lastIndex = -1
  let cueIndex = -1
  const popName = () => {
    if (reduced || typeof nameEl.animate !== 'function') return
    // a stepped "sprite spawn": in two hard frames
    nameEl.animate(
      [
        { transform: 'translate3d(0, 6px, 0)', opacity: 0 },
        { transform: 'translate3d(0, 2px, 0)', opacity: 1 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 240, easing: 'steps(3, end)' },
    )
  }
  const showLevel = (i: number, animate = true) => {
    const s = slots[i]
    if (!s) return
    const n = String(i + 1)
    if (lvNum.textContent === n && gameEl.textContent === s.def.label) return
    lvNum.textContent = n
    gameEl.textContent = s.def.label
    plainEl.textContent = ` · ${plainOf(s.def.id, s.def.label)}`
    if (animate) popName()
  }
  const cue = (i: number) => {
    cueIndex = i
    chrome.classList.add('is-cue')
    lvKey.textContent = 'Go to level'
    showLevel(i)
  }
  const uncue = () => {
    if (cueIndex < 0) return
    cueIndex = -1
    chrome.classList.remove('is-cue')
    lvKey.textContent = 'Level'
    if (lastIndex >= 0) showLevel(lastIndex)
  }
  pipEls.forEach((b, i) => {
    // a fingertip tap goes straight there; no hover cue left stuck behind
    b.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType !== 'touch') cue(i)
    })
    b.addEventListener('focus', () => cue(i))
    b.addEventListener('pointerleave', uncue)
    b.addEventListener('blur', uncue)
  })

  // --------------------------------------------------------------------- sound

  const syncSound = (on: boolean) => {
    for (const b of soundBtns) {
      b.setAttribute('aria-pressed', String(on))
      const st = b.querySelector('.ch-sound-state')
      if (st) st.textContent = on ? MICROCOPY.audioOn : MICROCOPY.audioOff
    }
    chrome.classList.toggle('is-sound', on)
  }
  for (const b of soundBtns)
    b.addEventListener('click', () => {
      sound.toggle()
      if (sound.enabled) sound.blip(2)
    })
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // ---------------------------------------------------------------- pause menu

  // A real modal: its own Resume button lives inside the dialog (drawn exactly
  // where Menu sits), focus moves in on open and back on close, Escape
  // closes, everything behind it is inert, and the game freezes behind the
  // glass like a console's pause screen.
  let menuOpen = false
  let hideTimer = 0
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    clearTimeout(hideTimer)
    menu.hidden = false
    // flush the closed state so the entrance runs
    void menu.offsetWidth
    chrome.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      $('.ch-top'),
      $('.ch-bottom'),
    ])
    engine.lenis.stop()
    sound.pause(true)
    holdScene('menu')
    menu.scrollTop = 0
    const now = menuLinks[lastIndex] ?? menuLinks[0]
    now?.focus({ preventScroll: true })
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    chrome.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    releaseScene('menu')
    engine.lenis.start()
    sound.pause(false)
    hideTimer = window.setTimeout(
      () => {
        if (!menuOpen) menu.hidden = true
      },
      reduced ? 20 : 200,
    )
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  menuClose.addEventListener('click', () => closeMenu())
  const onMenuKey = (e: KeyboardEvent) => {
    if (!menuOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    } else if (e.key === 'Tab') {
      const f = focusables()
      if (!f.length) return
      const i = f.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
      e.preventDefault()
      f[next].focus()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && menuLinks.includes(document.activeElement as HTMLAnchorElement)) {
      // a game menu: the arrows move the cursor through the level list
      e.preventDefault()
      const i = menuLinks.indexOf(document.activeElement as HTMLAnchorElement)
      const n = menuLinks.length
      menuLinks[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus()
    }
  }
  // capture: the dialog's own trap runs ahead of the no-`inert` fallback in inert.ts
  window.addEventListener('keydown', onMenuKey, true)
  matchMedia('(min-width: 901px)').addEventListener?.('change', e => {
    if (e.matches) closeMenu(false)
  })

  // -------------------------------------------------------------------- reveal

  let revealed = false
  const revealChrome = () => {
    if (revealed) return
    revealed = true
    chrome.classList.add('is-in')
    if (!reduced) {
      cueAnim(scoreBox, 'is-blink')
      cueAnim(livesBox, 'is-hop')
    }
  }
  if (document.documentElement.dataset.ready) revealChrome()
  else window.addEventListener('hark:reveal', revealChrome, { once: true })
  // safety net: never leave the chrome hidden
  const safety = () => (document.querySelector('#loader .ld') ? window.setTimeout(safety, 2000) : revealChrome())
  window.setTimeout(safety, 9000)

  // -------------------------------------------------------------------- update

  /** shown score: it counts up (or down) toward the target like points being tallied */
  let shownScore = -1
  let lastScoreText = ''
  let lastFill = -1

  return {
    update(frame: Frame, state: EngineState) {
      const slot = state.slots[state.index]
      if (!slot) return

      if (state.index !== lastIndex) {
        const first = lastIndex < 0
        lastIndex = state.index
        lastFill = -1
        if (cueIndex < 0) showLevel(state.index, !first)
        pipEls.forEach((t, i) => {
          t.classList.toggle('is-active', i === state.index)
          t.classList.toggle('is-past', i < state.index)
          if (i === state.index) t.setAttribute('aria-current', 'step')
          else t.removeAttribute('aria-current')
        })
        navEls.forEach(a => {
          const on = a.dataset.goto === slot.def.id
          a.classList.toggle('is-active', on)
          if (on) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        menuLinks.forEach((a, i) => {
          a.parentElement?.classList.toggle('is-now', i === state.index)
          if (i === state.index) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        chrome.dataset.chapter = slot.def.id
        // a new level: 1UP blinks and the hearts hop
        if (!reduced) {
          cueAnim(scoreBox, 'is-blink')
          cueAnim(livesBox, 'is-hop')
        }
      }

      // the current pip charges up with progress through the level (in 8 steps)
      const fill = Math.min(8, Math.floor(Math.min(1, Math.max(0, state.local)) * 8 + 1e-6))
      if (fill !== lastFill) {
        lastFill = fill
        pipFills[state.index]?.style.setProperty('--f', String(fill / 8))
      }

      // 1UP: 000000 at the title screen, 999999 at the very end
      const p = Math.min(1, Math.max(0, frame.progress))
      const target = p >= 0.999 ? 999999 : Math.floor(p * 99999.9) * 10
      if (shownScore < 0 || reduced || !Number.isFinite(shownScore)) shownScore = target
      else {
        const d = target - shownScore
        const step = d * (1 - Math.exp(-9 * Math.min(0.1, frame.dt)))
        shownScore = Math.abs(d) < 20 ? target : shownScore + step
      }
      const txt = pad6(target === 999999 && Math.abs(target - shownScore) < 20 ? 999999 : Math.round(shownScore / 10) * 10)
      if (txt !== lastScoreText) {
        // fixed-width digit cells: the count never jitters sideways
        for (let i = 0; i < 6; i++) if (txt[i] !== lastScoreText[i]) scoreDigits[i].textContent = txt[i]
        lastScoreText = txt
      }
    },
  }
}
