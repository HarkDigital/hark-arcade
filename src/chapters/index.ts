import type { ChapterDef } from '../core/types'

/**
 * The game, level by level. `length` is scroll distance in viewport heights;
 * `landing` is where nav jumps land (local progress).
 */
export const CHAPTERS: ChapterDef[] = [
  { id: 'hero', label: 'Title Screen', length: 2.6, landing: 0, load: () => import('./hero/index') },
  { id: 'work', label: 'Arcade Hall', length: 3.8, landing: 0.12, load: () => import('./work/index') },
  { id: 'services', label: 'Power-Ups', length: 3.8, landing: 0.08, load: () => import('./services/index') },
  { id: 'voices', label: 'Side Quests', length: 3.0, landing: 0.08, load: () => import('./voices/index') },
  { id: 'shield', label: 'Boss Fight', length: 1.9, landing: 0.45, load: () => import('./shield/index') },
  { id: 'process', label: 'World Map', length: 2.2, landing: 0.17, load: () => import('./process/index') },
  { id: 'contact', label: 'Continue?', length: 1.6, landing: 0.3, load: () => import('./contact/index') },
]
