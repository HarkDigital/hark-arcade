import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND } from '../content'
import { mountRotateGate } from './rotate'

/**
 * Persistent chrome. STUB — the UI build replaces the internals.
 * API: createChrome(root, engine, sound) -> { update(frame, state) }
 */
export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  root.innerHTML = `
    <div style="position:absolute;top:24px;left:var(--gutter)" class="hud-label">${BRAND.short}</div>
    <div style="position:absolute;bottom:24px;right:var(--gutter)" class="hud-label" data-idx></div>`
  const idx = root.querySelector<HTMLElement>('[data-idx]')!
  mountRotateGate(shown => (engine.paused = shown))
  void sound
  return {
    update(_frame: Frame, state: EngineState) {
      const slot = state.slots[state.index]
      const txt = `LEVEL ${state.index + 1}-${state.slots.length} — ${slot?.def.label ?? ''}`
      if (idx.textContent !== txt) idx.textContent = txt
    },
  }
}
