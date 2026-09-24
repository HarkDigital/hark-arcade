import { BRAND, CONTACT, MICROCOPY, PROCESS, SECTIONS, SECURITY, SERVICES, STATS, TESTIMONIALS, WORK, workImage } from '../content'
import { CONCEPT_TAG, WORDMARK } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'
import { ICON, pixelMark } from './pixelart'

/**
 * Plain HTML version of the story for browsers without WebGL2 (and the
 * last-resort view if boot fails), laid out as the game's INSTRUCTION
 * BOOKLET: cream paper pages on a dark desk, a cover with the pixel mark, a
 * contents page, then one spread per level (the work as a cartridge
 * catalogue, services as an item list, testimonials as character dialogue,
 * the security level as a boss page, the process as a world map) and the
 * "Continue?" page with the email. Same copy as the game, verbatim from
 * content.ts. Styled by the .fb-* rules in ui.css.
 *
 * Landmarks: the brand + primary nav are a real banner <header> just before
 * <main id="track"> and the credits a <footer> just after it, so "Skip to
 * content" (#track) lands on the booklet itself, past the navigation.
 */
export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  unmountRotateGate()
  // boot can fail while the loader still holds the page inert: let go of it
  releaseInert('loader')
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  /** the last word of a headline in signal green */
  const accent = (s: string) => {
    const t = esc(s)
    const i = t.lastIndexOf(' ')
    return i < 0 ? `<em>${t}</em>` : `${t.slice(0, i)} <em>${t.slice(i + 1)}</em>`
  }
  const newTab = '<span class="sr-only"> (opens in a new tab)</span>'
  const isPreview = (url: string) => /harktest\.com/.test(url)
  const pad2 = (n: number) => String(n).padStart(2, '0')

  const LEVELS = [
    { href: '#fb-top', game: 'Title Screen', plain: 'Home', page: 1 },
    { href: '#fb-work', game: 'Arcade Hall', plain: 'Work', page: 4 },
    { href: '#fb-services', game: 'Power-Ups', plain: 'Services', page: 8 },
    { href: '#fb-voices', game: 'Town Chatter', plain: 'Clients', page: 12 },
    { href: '#fb-security', game: 'Boss Fight', plain: 'Security', page: 15 },
    { href: '#fb-process', game: 'World Map', plain: 'Process', page: 17 },
    { href: '#fb-contact', game: 'Continue?', plain: 'Contact', page: 20 },
  ]
  /** the running head of each booklet page */
  const head = (i: number, extra: string) =>
    `<p class="fb-runhead"><span class="fb-lv">Level ${i + 1}</span><span class="fb-runhead-t">${esc(LEVELS[i].game)} · ${esc(extra)}</span></p>`
  const folio = (n: number) => `<p class="fb-folio" aria-hidden="true">${pad2(n)}</p>`

  // banner and footer sit around <main> (a second call replaces them)
  document.getElementById('fb-head')?.remove()
  document.getElementById('fb-foot')?.remove()
  const header = document.createElement('header')
  header.className = 'fb fb-head'
  header.id = 'fb-head'
  header.innerHTML = `
    <div class="fb-top">
      <a class="fb-brand" href="#fb-top" aria-label="${esc(BRAND.name)}, top of page">
        <span class="fb-mark">${pixelMark(20)}</span>
        <span class="fb-brand-text" aria-hidden="true"><span class="fb-word">${WORDMARK}</span><span class="fb-sub">${CONCEPT_TAG}</span></span>
      </a>
      <nav class="fb-nav" aria-label="Primary">
        <a class="fb-link" href="#fb-work">Work</a>
        <a class="fb-link" href="#fb-services">Services</a>
        <a class="fb-link" href="#fb-contact">Contact</a>
        <a class="hud-btn fb-cta" href="${CONTACT.href}">Start a project</a>
      </nav>
    </div>`
  const footer = document.createElement('footer')
  footer.className = 'fb fb-end'
  footer.id = 'fb-foot'
  footer.innerHTML = `
    <div class="fb-foot">
      <p>© ${new Date().getFullYear()} ${esc(BRAND.name)} · ${esc(BRAND.locale)}</p>
      <p class="fb-foot-links"><a href="${BRAND.classicSite}">Classic site</a><span aria-hidden="true"> · </span><a href="${BRAND.orbitSite}">Orbit</a><span aria-hidden="true"> · </span><a href="${BRAND.resonanceSite}">Resonance</a><span aria-hidden="true"> · </span><a href="${BRAND.pressSite}">Press</a><span aria-hidden="true"> · </span><a href="${BRAND.townSite}">Town</a></p>
    </div>`
  root.before(header)
  root.after(footer)

  root.style.pointerEvents = 'auto'
  root.innerHTML = `
  <div class="fb fb-body">
    <section class="fb-page fb-cover" id="fb-top" aria-labelledby="fb-h1">
      <p class="fb-cover-k"><span>Instruction booklet</span><span class="fb-cover-p">${esc(MICROCOPY.signalEyebrow)}</span></p>
      <div class="fb-cover-art" aria-hidden="true">${pixelMark(30, { shade: true })}<span class="fb-cover-stars">${ICON.star('fb-st fb-st--a')}${ICON.star('fb-st fb-st--b')}${ICON.star('fb-st fb-st--c')}</span></div>
      <p class="fb-cover-brand" aria-hidden="true">${WORDMARK}</p>
      <h1 class="fb-h1" id="fb-h1">${accent(BRAND.tagline)}</h1>
      <p class="fb-lede">${esc(BRAND.manifesto)}</p>
      <p class="fb-cover-foot"><span>${esc(BRAND.locale)}</span></p>
      <aside class="fb-note" aria-label="About this page">
        <p class="fb-note-k">Note</p>
        <p>This browser can’t power up the 3D arcade, so here is the whole game as its instruction booklet.</p>
      </aside>
    </section>

    <nav class="fb-page fb-contents" aria-labelledby="fb-contents-h">
      <h2 class="fb-h3 fb-contents-h" id="fb-contents-h">Contents</h2>
      <ol class="fb-toc">
        ${LEVELS.map(
          (l, i) => `<li><a class="fb-toc-a" href="${l.href}">
            <span class="fb-toc-n" aria-hidden="true">${i + 1}</span>
            <span class="fb-toc-name">${esc(l.plain)}</span>
            <span class="fb-toc-game">${esc(l.game)}</span>
            <span class="fb-toc-dots" aria-hidden="true"></span>
            <span class="fb-toc-pg" aria-hidden="true">${pad2(l.page)}</span>
          </a></li>`,
        ).join('')}
      </ol>
      ${folio(2)}
    </nav>

    <section class="fb-page" id="fb-work" aria-labelledby="fb-work-h">
      ${head(1, SECTIONS.work.eyebrow)}
      <h2 class="fb-h2" id="fb-work-h">${accent(SECTIONS.work.title)}</h2>
      <ul class="fb-work">
        ${WORK.map(
          w => `<li><a class="fb-cart" href="${w.url}" target="_blank" rel="noopener">
            <span class="fb-cart-img"><img src="${workImage(w.id)}" alt="" loading="lazy" decoding="async" width="1280" height="800">${
              isPreview(w.url) ? '<span class="fb-chip">Preview</span>' : ''
            }</span>
            <span class="fb-cart-name">${esc(w.name)}${isPreview(w.url) ? '<span class="sr-only"> (pre-launch preview)</span>' : ''}${newTab}</span>
            <span class="fb-cart-ind">${esc(w.industry)}</span>
            <span class="fb-cart-blurb">${esc(w.blurb)}</span>
          </a></li>`,
        ).join('')}
      </ul>
      ${folio(4)}
    </section>

    <section class="fb-page" id="fb-services" aria-labelledby="fb-services-h">
      ${head(2, SECTIONS.services.eyebrow)}
      <h2 class="fb-h2" id="fb-services-h">${accent(SECTIONS.services.title)}</h2>
      <ul class="fb-items">
        ${SERVICES.map(
          s => `<li class="fb-item"><p class="fb-item-n" aria-hidden="true">${s.num}</p><h3 class="fb-h3">${esc(s.title)}</h3><p class="fb-p">${esc(s.blurb)}</p><ul class="fb-tags">${s.tags
            .map(t => `<li>${esc(t)}</li>`)
            .join('')}</ul></li>`,
        ).join('')}
      </ul>
      ${folio(8)}
    </section>

    <section class="fb-page" id="fb-voices" aria-labelledby="fb-voices-h">
      ${head(3, SECTIONS.voices.eyebrow)}
      <h2 class="fb-h2" id="fb-voices-h">${accent(SECTIONS.voices.title)}</h2>
      <ul class="fb-quotes">
        ${TESTIMONIALS.map(
          t => `<li><figure class="fb-say"><figcaption class="fb-say-who">${esc(t.name)} <span>· ${esc(t.company)}</span></figcaption><blockquote><p>“${esc(t.quote)}”</p></blockquote></figure></li>`,
        ).join('')}
      </ul>
      ${folio(12)}
    </section>

    <section class="fb-page fb-boss" id="fb-security" aria-labelledby="fb-security-h">
      ${head(4, SECURITY.eyebrow)}
      <h2 class="fb-h2" id="fb-security-h">${accent(SECURITY.title)}</h2>
      <p class="fb-lede">${esc(SECURITY.body)}</p>
      <p class="fb-actions"><a class="hud-btn" href="${SECURITY.href}">${esc(SECURITY.cta)}</a></p>
      ${folio(15)}
    </section>

    <section class="fb-page" id="fb-process" aria-labelledby="fb-process-h">
      ${head(5, 'How we work')}
      <h2 class="fb-h2" id="fb-process-h">We listen first. Then we <em>build.</em></h2>
      <ol class="fb-map">
        ${PROCESS.map(
          (p, i) => `<li class="fb-stage"><p class="fb-stage-n" aria-hidden="true">${i + 1}</p><h3 class="fb-h3">${esc(p.title)}</h3><p class="fb-p">${esc(p.text)}</p></li>`,
        ).join('')}
      </ol>
      <ul class="fb-stats">
        ${STATS.map(st => `<li><span class="fb-stat">${esc(st.value)}</span><span class="fb-stat-l">${esc(st.label)}</span></li>`).join('')}
      </ul>
      ${folio(17)}
    </section>

    <section class="fb-page fb-contact" id="fb-contact" aria-labelledby="fb-contact-h">
      ${head(6, CONTACT.eyebrow)}
      <h2 class="fb-h1" id="fb-contact-h">${accent(CONTACT.title)}</h2>
      <p class="fb-lede">${esc(CONTACT.body)}</p>
      <p class="fb-actions">
        <a class="hud-btn" href="${CONTACT.href}">${esc(BRAND.email)}</a>
        <button class="hud-btn hud-btn--ghost fb-copy" type="button">Copy email address</button>
        <span class="fb-copy-status" aria-live="polite"></span>
      </p>
      ${folio(20)}
    </section>
  </div>`

  // copy the address (clipboard API, with a textarea fallback)
  const btn = root.querySelector<HTMLButtonElement>('.fb-copy')
  const status = root.querySelector<HTMLElement>('.fb-copy-status')
  btn?.addEventListener('click', async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(BRAND.email)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = BRAND.email
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
    }
    if (status) {
      status.textContent = ok ? 'Copied' : `Copy failed. The address is ${BRAND.email}`
      window.setTimeout(() => (status.textContent = ''), 2600)
    }
  })
}
