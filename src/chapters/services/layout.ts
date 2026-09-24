/*
 * Power-Ups run sheet (local progress 0..1, 3.8 viewport heights).
 *
 *   0.000–0.045  iris opens on the start line: READY?
 *   0.030–0.125  intro window: "Eleven ways to be heard." + INVENTORY (all 11)
 *   0.105–0.895  eleven beats, one per ?-block:
 *                  p 0.00–0.42  the player RUNS to the block (scrubbed by scroll)
 *                  p ≥ 0.42     the block is BONKED: it is used, its power-up
 *                               hovers above it and the item card names it.
 *                               Crossing p = 0.42 live plays the jump, the bonk,
 *                               the coin burst and the item pop in real time.
 *   0.895–0.930  run to the goal; all eleven items fly in and orbit the player
 *   0.925–1.000  POWER UP! — then the iris closes on the player
 *
 * World units: one tile = 1. The ground top is y = 0, the play plane z = 0.
 */

export const N = 11

export const INTRO_END = 0.105
export const SVC_END = 0.895
export const BEAT = (SVC_END - INTRO_END) / N
/** fraction of a beat spent running; the bonk lands right after */
export const RUN = 0.42
/** where item k sits settled (card named, item hovering) */
export const SETTLE = 0.72

export const beatStart = (k: number) => INTRO_END + k * BEAT
export const ANCHORS = Array.from({ length: N }, (_, k) => beatStart(k) + SETTLE * BEAT)

/** block spacing and positions */
export const SPACING = 6.5
export const blockX = (k: number) => 6 + k * SPACING
export const START_X = 0
export const GOAL_X = blockX(N - 1) + 5.5

/** heights */
export const BLOCK_SIZE = 1.1
export const BLOCK_Y = 3.1 + BLOCK_SIZE / 2
export const ITEM_Y = BLOCK_Y + BLOCK_SIZE / 2 + 1.15
export const HERO_VOXEL = 0.09
export const ITEM_VOXEL = 0.085

/** finale */
export const FIN_RUN_END = 0.93
export const POWER_AT = 0.925
