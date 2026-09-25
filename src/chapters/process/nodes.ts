import * as THREE from 'three'
import { P, glow } from '../../kit/pixel'
import { clamp, ease } from '../../core/math'
import { Builder, R, labelMesh, sheetMesh, canvasTex, FACET, OUTLINE } from './builder'
import { CLEAR, STACK, NODES, PLATEAU_H, START, groundAt, wx, wz } from './timeline'

/*
 * The four level nodes. Each is a little building (static, merged into the
 * island Builder) plus a few moving parts, a level pad that flips from coral
 * to gold, a flagpole whose flag runs up on CLEAR!, and a CLEAR! sign.
 *
 *   1 LISTEN     a cottage with a giant brass ear-trumpet; sound arcs roll in
 *   2 PROTOTYPE  a saw-tooth workshop, a turning gear, a blueprint on an
 *                easel and a wireframe model spinning over the roof
 *   3 BUILD      a castle with an unfinished tower: a glowing ghost outline
 *                marks the missing course, the blocks stack in one by one
 *                (falling-block style), a coin pops out, the flag goes up
 *   4 SUPPORT    a cosy inn with a beating heart sign and a smoking chimney
 */

const step = (t: number, fps: number) => Math.floor(t * fps) / fps
/** light blinks run this long after they start, then hold lit (WCAG 2.2.2) */
const BLINK_FOR = 4.5

export interface NodeParts {
  group: THREE.Group
  /** world anchors for the HUD tags (pad centres) */
  pads: THREE.Vector3[]
  start: THREE.Vector3
  /** since = seconds since the chapter was entered (blinks settle after BLINK_FOR) */
  update(l: number, time: number, calm: boolean, cam: THREE.Camera, since: number): void
}

/* ------------------------------------------------------------------ static buildings */

function listenHouse(b: Builder, x: number, y: number, z: number) {
  b.box(x, y, z, 2.3, 0.12, 1.7, R.stone, true)
  b.box(x, y + 0.12, z, 2.0, 1.0, 1.4, R.wall, true)
  // timber corners
  for (const s of [-1, 1]) b.box(x + s * 0.97, y + 0.12, z + 0.68, 0.1, 1.0, 0.08, R.wood)
  b.box(x, y + 1.02, z + 0.7, 2.0, 0.08, 0.06, R.wood)
  // door + step
  b.box(x + 0.15, y + 0.12, z + 0.71, 0.42, 0.64, 0.05, R.wood, true)
  b.box(x + 0.15, y + 0.12, z + 0.74, 0.34, 0.56, 0.02, R.trunk)
  b.box(x + 0.27, y + 0.42, z + 0.76, 0.05, 0.05, 0.02, R.gold)
  b.box(x + 0.15, y, z + 0.9, 0.6, 0.08, 0.26, R.stone)
  // windows
  for (const wx0 of [-0.55, 0.72]) {
    b.box(x + wx0, y + 0.44, z + 0.71, 0.38, 0.34, 0.04, R.wood)
    b.box(x + wx0, y + 0.47, z + 0.73, 0.3, 0.28, 0.02, R.window)
    b.box(x + wx0, y + 0.6, z + 0.745, 0.3, 0.03, 0.01, R.wood)
  }
  // flower box
  b.box(x - 0.55, y + 0.36, z + 0.78, 0.44, 0.08, 0.1, R.wood)
  for (let i = 0; i < 3; i++) b.box(x - 0.7 + i * 0.15, y + 0.44, z + 0.78, 0.08, 0.07, 0.07, i === 1 ? R.flowerY : R.flower)
  // stepped roof
  const roof: [number, number, number][] = [
    [2.4, 0.22, 1.8],
    [2.0, 0.22, 1.42],
    [1.54, 0.22, 1.0],
    [1.0, 0.2, 0.6],
  ]
  let ry = y + 1.12
  for (const [w, h, d] of roof) {
    b.box(x, ry, z, w, h, d, R.roofRed, true)
    ry += h
  }
  // mast + the giant ear trumpet (mouth facing west)
  const mx = x + 0.35
  b.box(mx, ry - 0.1, z, 0.08, 0.72, 0.08, R.metal, true)
  b.box(mx, ry + 0.6, z, 0.18, 0.1, 0.18, R.stoneDark, true)
  const hy = ry + 0.7
  for (let i = 0; i < 6; i++) {
    const s = 0.14 + i * i * 0.022 + i * 0.02
    b.box(mx - 0.08 - i * 0.13, hy + 0.08 - s / 2 + i * 0.03, z, 0.14, s, s, R.gold, true)
  }
  // dark throat in the bell
  const bell = 0.14 + 25 * 0.022 + 0.1
  b.box(mx - 0.08 - 5 * 0.13 - 0.075, hy + 0.08 - bell / 2 + 0.15 + 0.04, z, 0.02, bell - 0.14, bell - 0.14, R.dark)
  // little antenna with a light (light is a separate blinking mesh)
  b.box(x - 0.6, ry - 0.3, z - 0.2, 0.05, 0.9, 0.05, R.metal)
  return { mouth: new THREE.Vector3(mx - 0.08 - 5 * 0.13 - 0.1, hy + 0.2, z), tip: new THREE.Vector3(x - 0.6, ry + 0.64, z - 0.2) }
}

function workshop(b: Builder, x: number, y: number, z: number) {
  b.box(x, y, z, 2.5, 0.1, 1.7, R.stone, true)
  b.box(x, y + 0.1, z, 2.2, 0.95, 1.4, R.plank, true)
  // plank seams
  for (let i = -3; i <= 3; i++) if (Math.abs(i) > 1) b.box(x + i * 0.3, y + 0.1, z + 0.705, 0.03, 0.95, 0.01, R.wood)
  // garage door
  b.box(x - 0.15, y + 0.1, z + 0.71, 1.0, 0.74, 0.04, R.wood, true)
  b.box(x - 0.15, y + 0.1, z + 0.73, 0.88, 0.66, 0.02, R.stoneDark)
  for (let i = 0; i < 4; i++) b.box(x - 0.15, y + 0.22 + i * 0.15, z + 0.745, 0.88, 0.025, 0.01, R.stone)
  // window
  b.box(x + 0.78, y + 0.42, z + 0.71, 0.36, 0.32, 0.04, R.wood)
  b.box(x + 0.78, y + 0.45, z + 0.73, 0.28, 0.26, 0.02, R.glass)
  // flat roof slab + saw-tooth north lights (stepped, glass on the steep face)
  b.box(x, y + 1.05, z, 2.4, 0.1, 1.6, R.roofSlate, true)
  for (let k = 0; k < 3; k++) {
    const tx = x - 0.76 + k * 0.76
    b.box(tx, y + 1.15, z - 0.1, 0.72, 0.14, 1.3, R.roofSlate, true)
    b.box(tx, y + 1.29, z - 0.3, 0.72, 0.14, 0.9, R.roofSlate, true)
    b.box(tx, y + 1.43, z - 0.5, 0.72, 0.14, 0.5, R.roofSlate, true)
    b.box(tx, y + 1.15, z - 0.77, 0.66, 0.4, 0.04, R.glass)
  }
  // workbench + crates outside
  b.box(x + 1.45, y, z + 0.3, 0.4, 0.3, 0.4, R.plank, true)
  b.box(x + 1.45, y + 0.3, z + 0.3, 0.3, 0.26, 0.3, R.plank, true)
  b.box(x + 1.5, y, z - 0.35, 0.36, 0.34, 0.36, R.wood, true)
  // easel legs (the blueprint board is a sprite)
  b.box(x - 1.55, y, z + 0.82, 0.05, 0.9, 0.05, R.wood)
  b.box(x - 1.05, y, z + 0.82, 0.05, 0.9, 0.05, R.wood)
  b.box(x - 1.3, y, z + 0.62, 0.05, 0.86, 0.05, R.wood)
  return { gear: new THREE.Vector3(x - 0.2, y + 1.9, z + 0.62), board: new THREE.Vector3(x - 1.3, y + 0.86, z + 0.86), model: new THREE.Vector3(x + 0.7, y + 2.35, z) }
}

const TOWER_H = 1.28
const BLOCK_H = 0.52
/** the missing course: four blocks, back row first, each drops in (8 steps) */
const BRICK = 0.45
const BRICKS: [number, number][] = [
  [-0.235, -0.235],
  [0.235, -0.235],
  [-0.235, 0.235],
  [0.235, 0.235],
]
const FALL = 0.011
const DROP_H = 1.6
const brickAt = (i: number) => STACK[0] + (i * (STACK[1] - STACK[0] - FALL)) / (BRICKS.length - 1)
/** coin spin frames (scale.x): full, 3/4, edge, 3/4 */
const SPIN = [1, 0.62, 0.18, 0.62]

function castle(b: Builder, x: number, y: number, z: number) {
  // keep
  b.box(x, y, z, 2.6, 1.5, 1.6, R.stone, true)
  const merlons = (cx: number, cy: number, cz: number, w: number, d: number) => {
    const n = Math.max(2, Math.round(w / 0.42))
    for (let i = 0; i < n; i++) b.box(cx - w / 2 + (w / n) * (i + 0.5), cy, cz + d / 2 - 0.1, 0.22, 0.2, 0.2, R.stone, true)
    for (const s of [-1, 1]) b.box(cx + s * (w / 2 - 0.1), cy, cz, 0.2, 0.2, d * 0.5, R.stone, true)
  }
  merlons(x, y + 1.5, z, 2.6, 1.6)
  // stone courses
  for (let i = 1; i < 4; i++) b.box(x, y + i * 0.36, z + 0.805, 2.6, 0.03, 0.01, R.stoneDark)
  // gate + portcullis
  b.box(x, y, z + 0.81, 0.72, 0.84, 0.04, R.stoneDark, true)
  b.box(x, y, z + 0.83, 0.58, 0.72, 0.02, R.void)
  b.box(x, y + 0.72, z + 0.83, 0.4, 0.08, 0.02, R.void)
  for (let i = -2; i <= 2; i++) b.box(x + i * 0.11, y + 0.3, z + 0.845, 0.03, 0.46, 0.01, R.wood)
  // slit windows + banner
  for (const s of [-0.8, 0.8]) b.box(x + s, y + 0.86, z + 0.81, 0.1, 0.3, 0.02, R.void)
  b.box(x, y + 0.98, z + 0.81, 0.36, 0.4, 0.03, R.roofPurple)
  b.box(x, y + 1.08, z + 0.83, 0.12, 0.12, 0.02, R.gold)
  // finished tower (west) with a pointed roof and pennant
  const tx = x - 1.55
  b.box(tx, y, z + 0.1, 0.94, 2.5, 0.94, R.stone, true)
  for (const [dx, dz] of [[-0.33, 0.33], [0.33, 0.33], [-0.33, -0.33], [0.33, -0.33]]) b.box(tx + dx, y + 2.5, z + 0.1 + dz, 0.22, 0.2, 0.22, R.stone, true)
  b.box(tx, y + 2.5, z + 0.1, 0.62, 0.22, 0.62, R.roofRed, true)
  b.box(tx, y + 2.72, z + 0.1, 0.42, 0.22, 0.42, R.roofRed, true)
  b.box(tx, y + 2.94, z + 0.1, 0.22, 0.24, 0.22, R.roofRed, true)
  b.box(tx, y + 3.18, z + 0.1, 0.04, 0.34, 0.04, R.metal)
  b.box(tx + 0.13, y + 3.34, z + 0.1, 0.22, 0.14, 0.02, R.roofPurple)
  b.box(tx, y + 1.4, z + 0.58, 0.12, 0.34, 0.02, R.void)
  // unfinished tower (east): flat top, one course short
  const ux = x + 1.55
  b.box(ux, y, z + 0.1, 0.94, TOWER_H, 0.94, R.stone, true)
  b.box(ux, y + TOWER_H - 0.06, z + 0.1, 0.8, 0.06, 0.8, R.stoneDark)
  b.box(ux, y + 0.7, z + 0.58, 0.12, 0.3, 0.02, R.void)
  // spare blocks stacked by the gate
  b.box(x + 1.0, y, z + 1.25, 0.32, 0.24, 0.32, R.stone, true)
  b.box(x + 1.36, y, z + 1.2, 0.32, 0.24, 0.32, R.stone, true)
  b.box(x + 1.18, y + 0.24, z + 1.22, 0.32, 0.24, 0.32, R.stone, true)
  return { unfinished: new THREE.Vector3(ux, y + TOWER_H, z + 0.1) }
}

function inn(b: Builder, x: number, y: number, z: number) {
  b.box(x, y, z, 2.5, 0.1, 1.8, R.stone, true)
  b.box(x, y + 0.1, z, 2.2, 0.8, 1.5, R.wall, true)
  // upper floor (overhang), half-timbered
  b.box(x, y + 0.9, z, 2.4, 0.72, 1.62, R.plank, true)
  for (const fx of [-1.16, -0.4, 0.4, 1.16]) b.box(x + fx, y + 0.9, z + 0.815, 0.07, 0.72, 0.02, R.wood)
  b.box(x, y + 0.9, z + 0.815, 2.4, 0.06, 0.02, R.wood)
  for (const fx of [-0.78, 0.78]) {
    b.box(x + fx, y + 1.1, z + 0.82, 0.32, 0.3, 0.03, R.wood)
    b.box(x + fx, y + 1.13, z + 0.835, 0.24, 0.24, 0.01, R.window)
  }
  // door with a warm fanlight, lantern
  b.box(x, y + 0.1, z + 0.755, 0.48, 0.66, 0.04, R.wood, true)
  b.box(x, y + 0.1, z + 0.775, 0.38, 0.5, 0.02, R.trunk)
  b.box(x, y + 0.62, z + 0.78, 0.3, 0.1, 0.01, R.window)
  b.box(x, y, z + 0.95, 0.66, 0.08, 0.3, R.stone)
  for (const fx of [-0.7, 0.7]) {
    b.box(x + fx, y + 0.34, z + 0.755, 0.38, 0.32, 0.04, R.wood)
    b.box(x + fx, y + 0.37, z + 0.775, 0.3, 0.26, 0.02, R.window)
  }
  // bench
  b.box(x + 1.45, y, z + 0.6, 0.5, 0.16, 0.2, R.plank, true)
  // stepped roof
  let ry = y + 1.62
  for (const [w, h, d] of [
    [2.64, 0.22, 1.9],
    [2.2, 0.22, 1.44],
    [1.7, 0.22, 1.0],
    [1.1, 0.2, 0.56],
  ] as [number, number, number][]) {
    b.box(x, ry, z, w, h, d, R.roofPurple, true)
    ry += h
  }
  // chimney
  b.box(x + 0.72, y + 1.8, z - 0.2, 0.32, 0.9, 0.32, R.roofRed, true)
  b.box(x + 0.72, y + 2.7, z - 0.2, 0.4, 0.1, 0.4, R.stoneDark, true)
  // heart sign bracket
  b.box(x - 0.02, y + 1.62, z + 0.9, 0.06, 0.06, 0.24, R.metal)
  return { heart: new THREE.Vector3(x, y + 1.25, z + 1.0), chimney: new THREE.Vector3(x + 0.72, y + 2.8, z - 0.2), lantern: new THREE.Vector3(x - 0.42, y + 0.62, z + 0.86) }
}

/** add all four buildings + pads' poles to the static builder; returns hook points */
export function buildStatic(b: Builder) {
  const n = NODES
  const L = listenHouse(b, wx(n[0].bcol), 0, wz(n[0].brow))
  const W = workshop(b, wx(n[1].bcol), 0, wz(n[1].brow))
  const C = castle(b, wx(n[2].bcol), PLATEAU_H, wz(n[2].brow))
  const I = inn(b, wx(n[3].bcol), 0, wz(n[3].brow))
  // flagpoles
  for (const nd of n) {
    const x = wx(nd.col) + 0.5
    const z = wz(nd.row) - 0.3
    const y = groundAt(wx(nd.col), wz(nd.row))
    b.box(x, y, z, 0.12, 0.08, 0.12, R.stoneDark)
    b.box(x, y, z, 0.05, 1.12, 0.05, R.metal, true)
    b.box(x, y + 1.12, z, 0.11, 0.11, 0.11, R.gold, true)
  }
  return { L, W, C, I }
}

/* ------------------------------------------------------------------ moving parts */

const FLAG_MAP = { g: P.signal, d: P.green, c: P.cream, o: P.void }
function flagFrames() {
  // 12×8 waving flag, 3 frames: a column-offset sine, with the Hark diamond
  const frames: string[][] = []
  for (let f = 0; f < 3; f++) {
    const rows = Array.from({ length: 9 }, () => Array(13).fill('.'))
    for (let x = 0; x < 12; x++) {
      const off = x < 2 ? 0 : Math.round(Math.sin(x * 0.7 - f * 2.1) * 0.9)
      for (let y = 0; y < 7; y++) {
        const yy = y + 1 + off
        if (yy < 0 || yy > 8) continue
        const edge = y === 0 || y === 6 || x === 11
        rows[yy][x] = edge ? 'd' : 'g'
      }
      // diamond
      const dy = 4 + off
      const dxc = 5
      const r = 2 - Math.abs(x - dxc)
      if (r >= 0) for (let k = -r; k <= r; k++) if (dy + k >= 1 && dy + k <= 7) rows[dy + k][x] = 'c'
    }
    frames.push(rows.map(r => r.join('')))
  }
  return frames
}

function arcSprite(size: number) {
  // a ")" sound arc (pixel), size = radius in px
  const w = size + 3
  const h = size * 2 + 3
  const rows = Array.from({ length: h }, () => Array(w).fill('.'))
  for (let a = -70; a <= 70; a += 2) {
    const r = (a * Math.PI) / 180
    const px = Math.round(Math.cos(r) * size)
    const py = Math.round(Math.sin(r) * size) + size + 1
    for (const t of [0, 1]) {
      const xx = w - 2 - px + t
      if (xx >= 0 && xx < w && py >= 0 && py < h) rows[py][xx] = 'g'
    }
  }
  return [rows.map(r => r.join(''))]
}

function blueprintTexture() {
  const cv = document.createElement('canvas')
  cv.width = 40
  cv.height = 30
  const g = cv.getContext('2d')!
  g.fillStyle = P.blue
  g.fillRect(0, 0, 40, 30)
  g.fillStyle = P.cyan
  for (let x = 3; x < 40; x += 6) g.fillRect(x, 1, 1, 28)
  for (let y = 3; y < 30; y += 6) g.fillRect(1, y, 38, 1)
  g.fillStyle = P.white
  // a little castle drawing: walls, towers, gate
  g.fillRect(9, 12, 22, 1)
  g.fillRect(9, 12, 1, 12)
  g.fillRect(30, 12, 1, 12)
  g.fillRect(9, 24, 22, 1)
  g.fillRect(5, 8, 1, 16)
  g.fillRect(12, 8, 1, 4)
  g.fillRect(5, 8, 8, 1)
  g.fillRect(28, 8, 8, 1)
  g.fillRect(28, 8, 1, 4)
  g.fillRect(35, 8, 1, 16)
  g.fillRect(5, 24, 31, 1)
  for (const x of [6, 9, 30, 33]) g.fillRect(x, 6, 2, 2)
  g.fillRect(18, 18, 4, 1)
  g.fillRect(18, 18, 1, 6)
  g.fillRect(21, 18, 1, 6)
  // frame
  g.fillStyle = P.cream
  g.fillRect(0, 0, 40, 1)
  g.fillRect(0, 29, 40, 1)
  g.fillRect(0, 0, 1, 30)
  g.fillRect(39, 0, 1, 30)
  return canvasTex(cv)
}

function heartBuilder() {
  const b = new Builder()
  b.outlineWidth = 0.03
  // centred on its middle so the beat scales about the heart's centre
  b.voxelArt(
    ['.hh.hh.', 'hwhhhhh', 'hhhhhhh', 'hhhhhhm', '.hhhhm.', '..hhm..', '...m...'],
    { h: R.heart, w: R.white, m: [P.magenta, P.magenta, P.purple] },
    { size: 0.11, depth: 1, outline: true, y: -0.385 },
  )
  return b.mesh()
}

function gearBuilder() {
  const b = new Builder()
  b.outlineWidth = 0.03
  const m = new THREE.Matrix4()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    m.makeRotationZ(a)
    b.matrix = m
    b.box(0, 0.24, 0, 0.14, 0.16, 0.1, R.gold, true, true)
  }
  m.identity()
  b.matrix = m
  for (const a of [0, Math.PI / 4]) {
    m.makeRotationZ(a)
    b.box(0, -0.26, 0, 0.52, 0.52, 0.12, R.gold, true, true)
  }
  m.identity()
  b.box(0, -0.08, 0.02, 0.16, 0.16, 0.12, R.dark, false, true)
  b.matrix = null
  return b.mesh()
}

function wireCube(size: number, mat: THREE.Material) {
  return wireBox(size, size, size, 0.05, mat)
}

/** the 12 edges of a w×h×d box as thin bars (centred) */
function wireBox(w: number, h: number, d: number, t: number, mat: THREE.Material) {
  const g: THREE.BufferGeometry[] = []
  const hw = w / 2
  const hh = h / 2
  const hd = d / 2
  const edges: [number, number, number, number, number, number][] = []
  for (const a of [-hh, hh])
    for (const c of [-hd, hd]) edges.push([0, a, c, w + t, t, t])
  for (const a of [-hw, hw])
    for (const c of [-hd, hd]) edges.push([a, 0, c, t, h + t, t])
  for (const a of [-hw, hw])
    for (const c of [-hh, hh]) edges.push([a, c, 0, t, t, d + t])
  for (const [ex, ey, ez, ew, eh, ed] of edges) {
    const bx = new THREE.BoxGeometry(ew, eh, ed)
    bx.translate(ex, ey, ez)
    g.push(bx)
  }
  const merged = mergeBoxes(g)
  return new THREE.Mesh(merged, mat)
}

function mergeBoxes(list: THREE.BufferGeometry[]) {
  const pos: number[] = []
  const idx: number[] = []
  for (const geo of list) {
    const base = pos.length / 3
    const p = geo.getAttribute('position')
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i))
    const ix = geo.getIndex()!
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i))
    geo.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setIndex(idx)
  out.computeBoundingSphere()
  return out
}

function padMesh(ramp: typeof R.pad | typeof R.padClear | typeof R.padStart, dot: typeof R.white) {
  const b = new Builder()
  b.outlineWidth = 0.03
  b.box(0, 0, 0, 0.84, 0.1, 0.52, ramp, true)
  b.box(0, 0, 0, 0.52, 0.1, 0.84, ramp, true)
  b.box(0, 0, 0, 0.7, 0.1, 0.7, ramp)
  b.box(0, 0.1, 0, 0.26, 0.03, 0.26, dot)
  return b.mesh()
}

/**
 * Build the moving/stateful parts. `hooks` are the points returned by
 * buildStatic().
 */
export function buildNodes(hooks: ReturnType<typeof buildStatic>, mobile: boolean): NodeParts {
  const group = new THREE.Group()
  const pads: THREE.Vector3[] = []
  const padA: THREE.Mesh[] = []
  const padB: THREE.Mesh[] = []
  const flags: ReturnType<typeof sheetMesh>[] = []
  const clears: THREE.Mesh[] = []
  const flagBase: THREE.Vector3[] = []

  NODES.forEach(nd => {
    const x = wx(nd.col)
    const z = wz(nd.row)
    const y = groundAt(x, z)
    pads.push(new THREE.Vector3(x, y, z))
    const a = padMesh(R.pad, R.white)
    const b = padMesh(R.padClear, R.white)
    a.position.set(x, y, z)
    b.position.set(x, y, z)
    b.visible = false
    group.add(a, b)
    padA.push(a)
    padB.push(b)
    const f = sheetMesh(flagFrames(), FLAG_MAP, 0.046)
    f.mesh.position.set(x + 0.5 + 0.3, y + 0.8, z - 0.3)
    f.mesh.visible = false
    group.add(f.mesh)
    flags.push(f)
    flagBase.push(new THREE.Vector3(x + 0.5 + 0.3, y, z - 0.3))
    const c = labelMesh('CLEAR!', { font: 'display', px: 16, fg: P.gold, outline: P.void, shadow: P.magenta, height: 0.62 })
    c.position.set(x + 1.05, y + 1.55, z - 0.3)
    c.visible = false
    group.add(c)
    clears.push(c)
  })
  // START pad
  const sx = wx(START.col)
  const sz = wz(START.row)
  const startPad = padMesh(R.padStart, R.signal)
  startPad.position.set(sx, 0, sz)
  group.add(startPad)

  const ready = labelMesh('READY?', {
    font: 'display',
    px: 16,
    fg: P.cream,
    outline: P.void,
    shadow: P.magenta,
    height: 0.56,
    plate: { bg: P.night, border: P.signal },
  })
  ready.position.set(sx, 2.02, sz)
  group.add(ready)
  let readyT0 = -1

  // ---- 1 LISTEN: sound arcs rolling into the trumpet, an antenna light
  const arcs = [5, 8, 11].map(s => {
    const m = sheetMesh(arcSprite(s), { g: P.signal }, 0.05)
    ;(m.material as THREE.MeshBasicMaterial).color.setScalar(1.12)
    m.mesh.scale.x = -1
    group.add(m.mesh)
    return m.mesh
  })
  const mouth = hooks.L.mouth
  arcs.forEach((a, i) => a.position.set(mouth.x - 0.25 - i * 0.24, mouth.y, mouth.z + 0.05))
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glow(P.coral, 2.2))
  lamp.position.copy(hooks.L.tip)
  group.add(lamp)

  // ---- 2 PROTOTYPE: gear, blueprint, wireframe model
  const gear = gearBuilder()
  gear.position.copy(hooks.W.gear)
  group.add(gear)
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.6),
    new THREE.MeshBasicMaterial({ map: blueprintTexture() }),
  )
  board.position.copy(hooks.W.board)
  board.rotation.x = -0.28
  group.add(board)
  const boardBack = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.68, 0.04), OUTLINE)
  boardBack.position.copy(hooks.W.board).add(new THREE.Vector3(0, 0, -0.03))
  boardBack.rotation.x = -0.28
  group.add(boardBack)
  const wireMat = glow(P.cyan, 1.7)
  const wire = wireCube(0.56, wireMat)
  wire.position.copy(hooks.W.model)
  group.add(wire)
  const wireCore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), glow(P.cyan, 1.3))
  wire.add(wireCore)

  // ---- 3 BUILD: the missing course stacks in block by block (a ghost
  // outline marks the spot), a coin pops out, the flag goes up on CLEAR!
  const C = hooks.C
  const brickB = new Builder()
  brickB.outlineWidth = 0.025
  brickB.box(0, 0, 0, BRICK, BLOCK_H, BRICK, R.stone, true)
  brickB.box(0, BLOCK_H * 0.46, BRICK / 2 + 0.005, BRICK - 0.1, 0.035, 0.01, R.stoneDark)
  const brickGeo = brickB.geometry()
  const brickOut = brickB.outlineGeometry()
  const bricks = BRICKS.map(() => {
    const m = new THREE.Mesh(brickGeo, FACET)
    if (brickOut) {
      const o = new THREE.Mesh(brickOut, OUTLINE)
      o.renderOrder = -1
      m.add(o)
    }
    m.visible = false
    group.add(m)
    return m
  })
  const ghost = wireBox(0.94, BLOCK_H, 0.94, 0.045, glow(P.cyan, 1.25))
  ghost.position.set(C.unfinished.x, C.unfinished.y + BLOCK_H / 2, C.unfinished.z)
  group.add(ghost)
  const coinB = new Builder()
  coinB.outlineWidth = 0.025
  coinB.box(0, -0.17, 0, 0.22, 0.34, 0.06, R.coin, true)
  coinB.box(0, -0.12, 0, 0.34, 0.24, 0.06, R.coin, true)
  coinB.box(0, -0.1, 0.035, 0.06, 0.2, 0.01, [P.orange, P.orange, P.orange])
  const coin = coinB.mesh()
  coin.visible = false
  group.add(coin)
  const towerTopB = new Builder()
  towerTopB.outlineWidth = 0.03
  for (const [dx, dz] of [[-0.33, 0.33], [0.33, 0.33], [-0.33, -0.33], [0.33, -0.33]]) towerTopB.box(dx, 0, dz, 0.22, 0.2, 0.22, R.stone, true)
  towerTopB.box(0, 0, 0, 0.04, 0.5, 0.04, R.metal)
  towerTopB.box(0.13, 0.36, 0, 0.22, 0.14, 0.02, R.signal)
  const towerTop = towerTopB.mesh()
  towerTop.position.set(C.unfinished.x, C.unfinished.y + BLOCK_H, C.unfinished.z)
  group.add(towerTop)

  // ---- 4 SUPPORT: heart sign, chimney smoke, lantern
  const heart = heartBuilder()
  heart.position.copy(hooks.I.heart)
  group.add(heart)
  const puffGeo = new Builder()
  puffGeo.outlineWidth = 0.025
  puffGeo.box(0, 0, 0, 0.24, 0.2, 0.24, R.white, true, true)
  puffGeo.box(0.1, 0.08, 0.02, 0.14, 0.14, 0.14, R.white, true, true)
  const puffs = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(puffGeo.geometry(), FACET)
    const o = puffGeo.outlineGeometry()
    if (o) m.add(new THREE.Mesh(o, OUTLINE))
    group.add(m)
    return m
  })
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), glow(P.gold, 1.8))
  lantern.position.copy(hooks.I.lantern)
  group.add(lantern)

  const tmpQ = new THREE.Quaternion()
  void mobile

  return {
    group,
    pads,
    start: new THREE.Vector3(sx, 0, sz),
    update(l, time, calm, cam, since) {
      tmpQ.copy(cam.quaternion)
      const t8 = step(time, 8)
      // light blinks run for a few seconds after the level opens, then hold lit
      const lit = calm || since > BLINK_FOR
      // ---- pads, flags, CLEAR! signs
      for (let i = 0; i < 4; i++) {
        const c = CLEAR[i]
        const on = l >= c
        padA[i].visible = !on
        padB[i].visible = on
        const k = clamp((l - c) / 0.016)
        const f = flags[i]
        f.mesh.visible = on
        if (on) {
          const up = k >= 1 ? 1 : ease.outBack(k)
          f.mesh.position.y = flagBase[i].y + 0.24 + up * 0.72
          f.setFrame(calm ? 0 : Math.floor(time * 7) + i)
        }
        const s = clamp((l - c - 0.004) / 0.012)
        const lab = clears[i]
        // the last node's sign gives way to the WORLD CLEAR! banner (DOM)
        lab.visible = s > 0 && !(i === 3 && l >= 0.945)
        if (s > 0) {
          const sc = s >= 1 ? 1 : Math.max(0.01, ease.outBack(s))
          lab.scale.setScalar(sc)
          lab.quaternion.copy(tmpQ)
          const bob = calm ? 0 : (Math.floor(time * 2 + i) % 2) * 0.05
          lab.position.y = pads[i].y + 1.55 + bob
        }
      }
      // ---- READY? blinks 3 times from when it shows, then holds lit
      if (l < 0.085) {
        if (readyT0 < 0) readyT0 = time
        const rt = time - readyT0
        ready.visible = calm || rt > 3.6 || Math.floor(rt * 2.5) % 3 !== 2
        ready.quaternion.copy(tmpQ)
      } else {
        readyT0 = -1
        ready.visible = false
      }

      // ---- LISTEN: arcs roll in far → near, 6 fps; the lamp blinks
      const beat = calm ? 3 : Math.floor(time * 6) % 5
      for (let i = 0; i < arcs.length; i++) {
        const a = arcs[i]
        a.visible = calm ? true : beat === 2 - i || beat === 3 - i
        a.quaternion.copy(tmpQ)
        a.scale.x = -1
      }
      lamp.visible = lit || Math.floor(time * 1.5) % 2 === 0
      // ---- PROTOTYPE: gear steps round, model spins + bobs on steps
      gear.rotation.z = calm ? 0 : -Math.floor(time * 6) * (Math.PI / 16)
      wire.rotation.y = calm ? 0.6 : step(time, 10) * 0.9
      wire.rotation.x = 0.35
      wire.position.y = hooks.W.model.y + (calm ? 0 : (Math.floor(time * 2) % 2) * 0.05)
      // ---- BUILD: blocks drop in on 8 steps, a little squash as each lands,
      // a coin pops out of the finished course (all scroll-driven)
      const top = C.unfinished.y
      let landed = 0
      for (let i = 0; i < BRICKS.length; i++) {
        const m = bricks[i]
        const t0 = brickAt(i)
        m.visible = l >= t0
        if (!m.visible) continue
        const k = clamp((l - t0) / FALL)
        const kq = Math.floor(k * 8) / 8
        const land = t0 + FALL
        const squash = l >= land && l < land + 0.003
        if (l >= land) landed++
        m.position.set(C.unfinished.x + BRICKS[i][0], top + (1 - kq * kq) * DROP_H, C.unfinished.z + BRICKS[i][1])
        m.scale.set(squash ? 1.06 : 1, squash ? 0.84 : 1, squash ? 1.06 : 1)
      }
      ghost.visible = landed < BRICKS.length
      const ck = (l - STACK[1]) / 0.012
      coin.visible = ck > 0 && ck < 1
      if (coin.visible) {
        const q = Math.floor(ck * 12) / 12
        const sc = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3
        coin.position.set(C.unfinished.x, top + BLOCK_H + 0.3 + Math.sin(q * Math.PI * 0.5) * 0.95, C.unfinished.z)
        coin.quaternion.copy(tmpQ)
        coin.scale.set(Math.max(0.01, SPIN[Math.floor(q * 12) % 4] * sc), Math.max(0.01, sc), Math.max(0.01, sc))
      }
      const topK = clamp((l - CLEAR[2] - 0.002) / 0.012)
      towerTop.visible = topK > 0
      towerTop.scale.set(1, topK >= 1 ? 1 : Math.max(0.01, ease.outBack(topK)), 1)
      // ---- SUPPORT: heartbeat (two beats, pause), smoke puffs, lantern flicker
      const hb = calm ? 0 : Math.floor(time * 4) % 5
      heart.scale.setScalar(hb === 0 || hb === 2 ? 1.16 : 1)
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i]
        const ph = calm ? 0.35 + i * 0.25 : ((time * 0.55 + i / 3) % 1)
        const q = Math.floor(ph * 8) / 8
        p.position.set(hooks.I.chimney.x + q * 0.35, hooks.I.chimney.y + q * 1.2, hooks.I.chimney.z)
        p.scale.setScalar(0.5 + q * 0.9)
        p.visible = q < 0.9
      }
      lantern.visible = lit || Math.floor(t8 * 8) % 7 !== 0
    },
  }
}
