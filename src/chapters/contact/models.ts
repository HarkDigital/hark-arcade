import * as THREE from 'three'
import { P, glow, toon, voxels } from '../../kit/pixel'
import { logoGeometry } from '../../logo/logo'

/*
 * The CONTINUE? screen's props, all built on a 0.1 voxel grid so they read as
 * pixel art once the CRT pass has had its way:
 *   - chunky countdown digits 4..9 (gold face, orange sides)
 *   - the arcade coin door (steel frame, lit coin slot, coin-return button)
 *   - a coin (spins on 8 fps steps, like a sprite)
 *   - the Hark mark (extruded, signal green; a white frame when the timer stops)
 */

const DIGITS: Record<number, string[]> = {
  9: ['.#####.', '##...##', '##...##', '##...##', '.######', '.....##', '.....##', '##...##', '.#####.'],
  8: ['.#####.', '##...##', '##...##', '.#####.', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  7: ['#######', '##...##', '.....##', '....##.', '...##..', '...##..', '..##...', '..##...', '..##...'],
  6: ['.#####.', '##...##', '##.....', '##.....', '######.', '##...##', '##...##', '##...##', '.#####.'],
  5: ['#######', '##.....', '##.....', '######.', '.....##', '.....##', '.....##', '##...##', '.#####.'],
  4: ['....##.', '...###.', '..####.', '.##.##.', '##..##.', '#######', '....##.', '....##.', '....##.'],
}

/** pad an ASCII layer by one empty cell all round */
const pad = (rows: string[]) => {
  const w = rows[0].length + 2
  return ['.'.repeat(w), ...rows.map(r => `.${r}.`), '.'.repeat(w)]
}
/** the layer's silhouette grown by one cell (8-neighbour), as `ch` */
function dilate(rows: string[], ch: string) {
  const h = rows.length
  const w = rows[0].length
  const on = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.'
  return rows.map((r, y) =>
    r
      .split('')
      .map((_, x) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) return ch
        return '.'
      })
      .join(''),
  )
}

/** a digit: face layer 'a' (gold), two layers of side 'b' (orange), a black outline plate behind */
function digit(n: number) {
  const face = pad(DIGITS[n])
  const side = face.map(r => r.replace(/#/g, 'b'))
  const front = face.map(r => r.replace(/#/g, 'a'))
  return voxels([front, side, side, dilate(face, 'k')], { a: P.gold, b: P.orange, k: P.void })
}

export function buildDigits(): Map<number, THREE.Group> {
  const m = new Map<number, THREE.Group>()
  for (const n of [9, 8, 7, 6, 5, 4]) m.set(n, digit(n))
  return m
}
/** voxel units of a digit (for layout) */
export const DIGIT_W = 7
export const DIGIT_H = 9

/*
 * Coin door, 13 x 16 voxels: a steel door plate, a black bezel with the lit
 * coin slit, and a gold price plate. Front layer: the parts that stand proud
 * (bevel, bezel, price plate); layer 1: the plate face with the lit slit;
 * layer 2: the back.
 */
const DOOR_FRONT = [
  '.sssssssssss.',
  'sSSSSSSSSSSSs',
  'sS.........Ss',
  'sS..kkkkk..Ss',
  'sS..kk.kk..Ss',
  'sS..kk.kk..Ss',
  'sS..kk.kk..Ss',
  'sS..kk.kk..Ss',
  'sS..kk.kk..Ss',
  'sS..kkkkk..Ss',
  'sS.........Ss',
  'sS.ggggggg.Ss',
  'sS.ggggggg.Ss',
  'sS.........Ss',
  'sSSSSSSSSSSSs',
  '.sssssssssss.',
]
const DOOR_FACE = DOOR_FRONT.map((r, y) =>
  r
    .split('')
    .map((c, x) => {
      if (c === 's' || c === 'S') return c
      if (c === '.' && (x === 0 || x === 12)) return '.'
      if (y >= 4 && y <= 8 && x === 6) return 'L'
      return 'p'
    })
    .join(''),
)
const DOOR_BACK = DOOR_FRONT.map(r => r.replace(/[^.]/g, 's'))
export const DOOR_W = 13
export const DOOR_H = 16
/** the slit's centre, in voxels above the door's centre */
export const SLOT_DY = 1.5

export interface Door {
  group: THREE.Group
  slot: THREE.MeshBasicMaterial
}

export function buildDoor(): Door {
  const slot = glow(P.coral, 1.6)
  const map = { s: P.night, S: P.steel, p: P.slate, g: P.gold, k: P.void, L: '#ff5a6f' }
  const group = voxels([DOOR_FRONT, DOOR_FACE, DOOR_BACK], map, {
    material: c => (c === '#ff5a6f' ? slot : toon(c)),
  })
  return { group, slot }
}

const COIN = [
  '..ooooo..',
  '.oyyyyyo.',
  'oyywwyyyo',
  'oywyyyyyo',
  'oyyyyyyyo',
  'oyyyyyyyo',
  'oyyyyyyyo',
  '.oyyyyyo.',
  '..ooooo..',
]
export const COIN_W = 9

export function buildCoin() {
  return voxels(COIN, { o: P.orange, y: P.gold, w: P.white }, { depth: 2 })
}

export interface Mark {
  mesh: THREE.Mesh
  lit: THREE.Material
  flash: THREE.Material
}

let markGeo: THREE.BufferGeometry | null = null
export function buildMark(): Mark {
  markGeo ??= logoGeometry({ depth: 0.26, bevelSize: 0.01, bevelThickness: 0.014, curveSegments: 18 })
  const lit = toon(P.signal)
  const flash = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.white) })
  const mesh = new THREE.Mesh(markGeo, lit)
  return { mesh, lit, flash }
}
