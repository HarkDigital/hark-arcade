import { clamp, lerp, smoothstep } from '../../core/math'

/*
 * WORLD MAP — "We listen first. Then we build."
 *
 * A 16-bit overworld: one voxel island, a dotted path, four level nodes.
 * The player walks node to node; each node flips to CLEAR! (flag up, star
 * burst) as it is beaten, then a RESULTS screen tallies the stats.
 *
 *   0.00–0.07  iris opens on the player at START ("READY?"), camera lifts
 *   0.065      title window: How we work / We listen first. Then we build.
 *   0.07–0.13  the whole map (overview)
 *   0.125–0.19 walk START → 1 LISTEN      (card WORLD 1-01 from 0.135)
 *   0.265      1 CLEAR!
 *   0.30–0.37  walk → 2 PROTOTYPE         (card 1-02)
 *   0.425      2 CLEAR!
 *   0.46–0.535 walk → 3 BUILD (up the stairs to the castle; the tower's
 *              missing course stacks in block by block 0.54–0.578, a coin
 *              pops out)
 *   0.585      3 CLEAR! (merlons + flag pop up on the tower)
 *   0.62–0.70  walk → 4 SUPPORT           (card 1-04)
 *   0.745      4 CLEAR!
 *   0.80–0.945 RESULTS screen (stats tally), map pulled back, fireworks
 *   0.945–1.00 WORLD CLEAR! banner — camera closes on the player, the iris
 *              shuts on the face
 */

export const HEAD: [number, number] = [0.065, 0.79]
export const WALK: [number, number][] = [
  [0.125, 0.19],
  [0.3, 0.37],
  [0.46, 0.535],
  [0.62, 0.7],
]
export const CLEAR = [0.265, 0.425, 0.585, 0.745]
/** the level card shows node i from CARD[i] until the next card (or CARD_OUT) */
export const CARD = [0.135, 0.3, 0.46, 0.62]
export const CARD_OUT = 0.79
export const RESULTS: [number, number] = [0.8, 0.945]
/** the tower's last course drops in, block by block (first starts → last lands) */
export const STACK: [number, number] = [0.54, 0.578]
/** the WORLD CLEAR! banner */
export const WON = 0.945
/** keyboard stops: the player standing on each node, its card up */
export const ANCHORS = [0.225, 0.395, 0.56, 0.72]

/** Which node's card is up at l (-1 = none). */
export function cardAt(l: number) {
  if (l < CARD[0] || l >= CARD_OUT) return -1
  for (let i = 3; i >= 0; i--) if (l >= CARD[i]) return i
  return -1
}

export const cleared = (l: number, i: number) => l >= CLEAR[i]

/* ------------------------------------------------------------------ tile map */

/*
 * 30 × 19 tiles, north up. '~' sea · '.' grass · '^' plateau (raised) ·
 * 'r' river · 'B' bridge over the river · 'S' stairs up to the plateau.
 * Land next to the sea becomes beach.
 */
export const MAP = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~.......~~~~~........~~~~~',
  '~~~...........~..^^^^^^^^^.~~~',
  '~~........r.....^^^^^^^^^^^.~~',
  '~~........r.....^^^^^^^^^^^.~~',
  '~.........r.....^^^^^^^^^^^..~',
  '~.........rr....^^^^^^^^^^^..~',
  '~..........r....^^^^^^^^^^^..~',
  '~..........r....^^^^^^^^^^^..~',
  '~..........r.......S...S.....~',
  '~..........r.................~',
  '~..........rr................~',
  '~...........r................~',
  '~...........r................~',
  '~...........B................~',
  '~~..........r...............~~',
  '~~........~~~~.............~~~',
  '~~~~.....~~~~~~~........~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
]
export const COLS = MAP[0].length
export const ROWS = MAP.length
export const PLATEAU_H = 0.6
export const SEA_Y = -0.45
export const RIVER_Y = -0.22

/** tile centre → world */
export const wx = (col: number) => col - (COLS - 1) / 2
export const wz = (row: number) => row - (ROWS - 1) / 2
/** world → tile */
export const tcol = (x: number) => Math.round(x + (COLS - 1) / 2)
export const trow = (z: number) => Math.round(z + (ROWS - 1) / 2)

export function tile(col: number, row: number) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return '~'
  return MAP[row][col]
}
export const isSea = (c: string) => c === '~'
export const isRiver = (c: string) => c === 'r' || c === 'B'
export const isLand = (c: string) => !isSea(c) && !isRiver(c)

/** ground height at a world point (stairs ramp up to the plateau northward) */
export function groundAt(x: number, z: number) {
  const c = tcol(x)
  const r = trow(z)
  const t = tile(c, r)
  if (t === '^') return PLATEAU_H
  if (t === 'S') {
    // plateau edge is the tile's north side
    const k = clamp(wz(r) + 0.5 - z)
    return Math.round(k * 3) / 3 * PLATEAU_H
  }
  if (t === 'B') return 0.08
  return 0
}

/* ------------------------------------------------------------------ nodes + path */

export interface NodeDef {
  col: number
  row: number
  /** building footprint centre (tiles) */
  bcol: number
  brow: number
}

export const START = { col: 4, row: 15 }
export const NODES: NodeDef[] = [
  { col: 7, row: 12, bcol: 7, brow: 9.6 },
  { col: 15, row: 14, bcol: 15, brow: 11.6 },
  { col: 19, row: 7, bcol: 19.5, brow: 3.7 },
  { col: 25, row: 13, bcol: 25, brow: 10.6 },
]

/** orthogonal waypoints (tiles); node indices into this list below */
const WAY: [number, number][] = [
  [4, 15],
  [4, 12],
  [7, 12], // 1
  [7, 14],
  [15, 14], // 2
  [19, 14],
  [19, 7], // 3
  [23, 7],
  [23, 13],
  [25, 13], // 4
]
const NODE_WAY = [0, 2, 4, 6, 9]

export interface PathPt {
  x: number
  z: number
}

export const PATH: PathPt[] = WAY.map(([c, r]) => ({ x: wx(c), z: wz(r) }))
export const PATH_LEN: number[] = [0]
for (let i = 1; i < PATH.length; i++)
  PATH_LEN.push(PATH_LEN[i - 1] + Math.hypot(PATH[i].x - PATH[i - 1].x, PATH[i].z - PATH[i - 1].z))
export const TOTAL = PATH_LEN[PATH_LEN.length - 1]
/** path distance of START and each node */
export const NODE_S = NODE_WAY.map(i => PATH_LEN[i])

/** point on the path at distance s; writes direction too */
export function pathAt(s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const d = clamp(s, 0, TOTAL)
  let i = 1
  while (i < PATH.length - 1 && PATH_LEN[i] < d) i++
  const a = PATH[i - 1]
  const b = PATH[i]
  const len = PATH_LEN[i] - PATH_LEN[i - 1]
  const t = len > 0 ? (d - PATH_LEN[i - 1]) / len : 0
  out.x = lerp(a.x, b.x, t)
  out.z = lerp(a.z, b.z, t)
  out.dx = len > 0 ? (b.x - a.x) / len : 0
  out.dz = len > 0 ? (b.z - a.z) / len : 1
  return out
}

export interface PlayerAt {
  s: number
  walking: boolean
  seg: number
}

const setAt = (o: PlayerAt, s: number, walking: boolean, seg: number) => {
  o.s = s
  o.walking = walking
  o.seg = seg
  return o
}

/** Where the player is along the path at l (distance), and whether walking. */
export function playerS(l: number, out: PlayerAt = { s: 0, walking: false, seg: -1 }) {
  if (l < WALK[0][0]) return setAt(out, NODE_S[0], false, -1)
  for (let i = 0; i < WALK.length; i++) {
    const [a, b] = WALK[i]
    if (l < a) return setAt(out, NODE_S[i], false, -1)
    if (l < b) {
      const k = clamp((l - a) / (b - a))
      // ease in/out: start walking, stride, stop on the node
      const e = k * k * (3 - 2 * k)
      return setAt(out, lerp(NODE_S[i], NODE_S[i + 1], e), k > 0.001 && k < 0.999, i)
    }
  }
  return setAt(out, NODE_S[4], false, -1)
}

/* ------------------------------------------------------------------ camera shots */

export interface Shot {
  x: number
  y: number
  z: number
  /** subject size to fit in the free band (world units) */
  w: number
  h: number
  /** elevation, degrees */
  el: number
  fov: number
}

export const OVERVIEW: Shot = { x: 0.2, y: 0, z: 0.4, w: 28.5, h: 17.5, el: 56, fov: 24 }

/**
 * Blend two shots. Size blends in log space (a zoom feels even); when zooming
 * IN the aim reaches the new subject early, when zooming OUT it lingers on the
 * old one — so the subject never slides out of frame mid-zoom.
 */
export function mixShot(a: Shot, b: Shot, t: number, out: Shot) {
  const zoomIn = b.w < a.w
  const tp = zoomIn ? 1 - (1 - t) ** 3 : t * t * t
  out.x = lerp(a.x, b.x, tp)
  out.y = lerp(a.y, b.y, tp)
  out.z = lerp(a.z, b.z, tp)
  out.w = Math.exp(lerp(Math.log(a.w), Math.log(b.w), t))
  out.h = Math.exp(lerp(Math.log(a.h), Math.log(b.h), t))
  out.el = lerp(a.el, b.el, t)
  out.fov = lerp(a.fov, b.fov, t)
  return out
}

/** camera beats: close on START → overview → follow → overview → close on the player */
export const CAM = {
  startOut: [0.03, 0.085] as [number, number],
  follow: [0.122, 0.165] as [number, number],
  results: [0.785, 0.83] as [number, number],
  end: [0.93, 1.0] as [number, number],
}

export const easeBeat = (a: number, b: number, l: number) => smoothstep(a, b, l)
