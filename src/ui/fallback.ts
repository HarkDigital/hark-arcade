import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { WORDMARK } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'

/**
 * Plain HTML version of the story for browsers without WebGL2 (and the
 * last-resort view if boot fails): every level's copy, in order.
 * STUB styling — the UI build restyles it (.fb-* rules in ui.css).
 */
export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  unmountRotateGate()
  releaseInert('loader')
  root.style.pointerEvents = 'auto'
  root.innerHTML = `<div class="fb"><header class="fb-top">${WORDMARK}</header><div class="fb-main" id="fb-main"></div></div>`
  const main = root.querySelector<HTMLElement>('#fb-main')!
  for (const id of CHAPTER_COPY_IDS) {
    const copy = buildChapterCopy(id, true)
    if (!copy) continue
    const sec = document.createElement('section')
    sec.className = 'fb-level'
    sec.appendChild(copy)
    main.appendChild(sec)
  }
}
