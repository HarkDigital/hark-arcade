import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { rng } from '../../core/math'
import { KEY } from './art'

/*
 * Chapter-local pixel graphics for Power-Ups.
 *
 * Everything here is UNLIT (MeshBasicMaterial) with colours taken straight
 * from the Hark-16 palette, and shading is baked by stepping each colour to
 * its darker palette neighbour (SHADE). So what reaches the CRT pass is
 * already palette-exact: the snap never has to guess, nothing turns to mud,
 * and every silhouette stays crisp.
 */

/** darker palette neighbour of each colour (side faces, undersides) */
const SHADE: Record<string, string> = {
  [P.void]: P.void,
  [P.night]: P.void,
  [P.indigo]: P.night,
  [P.purple]: P.indigo,
  [P.magenta]: P.purple,
  [P.coral]: P.magenta,
  [P.orange]: P.brown,
  [P.gold]: P.orange,
  [P.cream]: P.steel,
  [P.white]: P.steel,
  [P.steel]: P.slate,
  [P.slate]: P.night,
  [P.signal]: P.green,
  [P.green]: P.pine,
  [P.pine]: P.night,
  [P.cyan]: P.blue,
  [P.blue]: P.indigo,
  [P.brown]: P.night,
}
export const shade = (hex: string) => SHADE[hex] ?? hex

const _c = new THREE.Color()

/* ------------------------------------------------------------------ */
/* voxel mesher: exposed faces only, vertex-coloured, one draw call     */
/* ------------------------------------------------------------------ */

// face: normal, u, v (u × v = normal) and whether it takes the shaded colour
const FACES: { n: number[]; u: number[]; v: number[]; dark: boolean }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], dark: true },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], dark: true },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], dark: false },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], dark: true },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], dark: false },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], dark: false },
]

export interface VoxelOpts {
  size: number
  depth: number
  /** anchor: 'center' (default) or 'bottom' (y = 0 at the feet) */
  anchor?: 'center' | 'bottom'
  map?: Record<string, string>
}

/** A voxel model from one ASCII layer, extruded `depth` voxels. */
export function voxelGeometry(rows: string[], o: VoxelOpts): THREE.BufferGeometry {
  const map = o.map ?? KEY
  const h = rows.length
  const w = Math.max(...rows.map(r => r.length))
  const d = o.depth
  const s = o.size
  const col = (x: number, y: number) => {
    if (y < 0 || y >= h || x < 0) return undefined
    const ch = rows[y][x]
    return ch ? map[ch] : undefined
  }
  const filled = (x: number, y: number, z: number) => z >= 0 && z < d && col(x, y) !== undefined
  const ox = ((w - 1) * s) / 2
  const oy = o.anchor === 'bottom' ? -s / 2 : ((h - 1) * s) / 2
  const oz = ((d - 1) * s) / 2
  const pos: number[] = []
  const clr: number[] = []
  const idx: number[] = []
  const hs = s / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = col(x, y)
      if (!base) continue
      for (let z = 0; z < d; z++) {
        const cx = x * s - ox
        const cy = (h - 1 - y) * s - oy
        const cz = oz - z * s
        for (const f of FACES) {
          // neighbour in this face's direction (rows run top→down, layers front→back)
          if (filled(x + f.n[0], y - f.n[1], z - f.n[2])) continue
          _c.set(f.dark ? shade(base) : base)
          const i0 = pos.length / 3
          for (const [a, b] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            pos.push(
              cx + (f.n[0] + a * f.u[0] + b * f.v[0]) * hs,
              cy + (f.n[1] + a * f.u[1] + b * f.v[1]) * hs,
              cz + (f.n[2] + a * f.u[2] + b * f.v[2]) * hs,
            )
            clr.push(_c.r, _c.g, _c.b)
          }
          idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
        }
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

let voxMat: THREE.MeshBasicMaterial | null = null
/** the shared unlit vertex-colour material for every voxel model */
export function voxelMaterial() {
  return (voxMat ??= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
}

/* ------------------------------------------------------------------ */
/* canvas pixel textures                                                */
/* ------------------------------------------------------------------ */

export function pixelTexture(cv: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(cv)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export function canvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return { cv, ctx }
}

/** Draw ASCII art at (ox, oy), 1 px per char. */
export function drawArt(ctx: CanvasRenderingContext2D, rows: string[], ox = 0, oy = 0, map: Record<string, string> = KEY) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = map[row[x]]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(ox + x, oy + y, 1, 1)
    }
  })
}

/** ASCII art → data URL (for DOM icons; scale with image-rendering: pixelated). */
export function artDataUrl(rows: string[]) {
  const w = Math.max(...rows.map(r => r.length))
  const { cv, ctx } = canvas(w, rows.length)
  drawArt(ctx, rows)
  return cv.toDataURL('image/png')
}

/** A flat, unlit pixel sprite plane from ASCII art (bottom-centred when `feet`). */
export function artSprite(rows: string[], px: number, feet = false): THREE.Mesh {
  const w = Math.max(...rows.map(r => r.length))
  const { cv, ctx } = canvas(w, rows.length)
  drawArt(ctx, rows)
  const geo = new THREE.PlaneGeometry(w * px, rows.length * px)
  if (feet) geo.translate(0, (rows.length * px) / 2, 0)
  const mat = new THREE.MeshBasicMaterial({ map: pixelTexture(cv), transparent: true, alphaTest: 0.5, toneMapped: false })
  return new THREE.Mesh(geo, mat)
}

/* ------------------------------------------------------------------ */
/* blocks: one texture atlas per block state, 4 tiles of 16×16          */
/*   [front, side, top, bottom]                                         */
/* ------------------------------------------------------------------ */

const QMARK = ['.wwww.', 'ww..ww', '....ww', '...ww.', '..ww..', '..ww..', '......', '..ww..', '..ww..']

type BlockKind = 'q' | 'used' | 'brick'

function blockTile(ctx: CanvasRenderingContext2D, ox: number, kind: BlockKind, face: 'front' | 'side' | 'top' | 'bottom', glyph = P.white) {
  const dark = face === 'side' || face === 'bottom'
  const t = (hex: string) => (dark ? shade(hex) : hex)
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(ox + x, y, 1, 1)
  }
  if (kind === 'brick') {
    ctx.fillStyle = t(P.brown)
    ctx.fillRect(ox, 0, 16, 16)
    for (let row = 0; row < 4; row++) {
      const y = row * 4
      for (let x = 0; x < 16; x++) px(x, y + 3, P.void)
      for (let x = 0; x < 16; x++) px(x, y, t(P.orange))
      const off = row % 2 ? 4 : 0
      for (let b = 0; b < 3; b++) {
        const x = (off + b * 8) % 16
        for (let yy = 0; yy < 3; yy++) px(x, y + yy, P.void)
        px((x + 1) % 16, y, t(P.orange))
      }
    }
    return
  }
  const body = kind === 'used' ? P.brown : P.gold
  const hi = kind === 'used' ? P.orange : P.cream
  const lo = kind === 'used' ? P.night : P.orange
  ctx.fillStyle = t(body)
  ctx.fillRect(ox, 0, 16, 16)
  if (!dark) {
    for (let i = 1; i < 15; i++) {
      px(i, 1, t(hi))
      px(1, i, t(hi))
    }
  }
  for (let i = 1; i < 15; i++) {
    px(i, 14, t(lo))
    px(14, i, t(lo))
  }
  for (let i = 0; i < 16; i++) {
    px(i, 0, P.void)
    px(i, 15, P.void)
    px(0, i, P.void)
    px(15, i, P.void)
  }
  if (face === 'front') {
    const rivet = kind === 'used' ? P.void : P.brown
    for (const [x, y] of [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
    ])
      px(x, y, rivet)
    if (kind === 'q') {
      // the "?" with a hard drop shadow
      const gx = 5,
        gy = 3
      QMARK.forEach((r, y) => {
        for (let x = 0; x < r.length; x++) if (r[x] === 'w') px(gx + x + 1, gy + y + 1, P.brown)
      })
      QMARK.forEach((r, y) => {
        for (let x = 0; x < r.length; x++) if (r[x] === 'w') px(gx + x, gy + y, glyph)
      })
    }
  }
}

export function blockAtlas(kind: BlockKind, glyph = P.white) {
  const { cv, ctx } = canvas(64, 16)
  blockTile(ctx, 0, kind, 'front', glyph)
  blockTile(ctx, 16, kind, 'side')
  blockTile(ctx, 32, kind, 'top')
  blockTile(ctx, 48, kind, 'bottom')
  return pixelTexture(cv)
}

/** A cube whose faces read from a 4-tile atlas: [front/back, sides, top, bottom]. */
export function blockGeometry(size: number) {
  const g = new THREE.BoxGeometry(size, size, size)
  const uv = g.attributes.uv as THREE.BufferAttribute
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const tile = [1, 1, 2, 3, 0, 0]
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setX(i, (tile[f] + uv.getX(i)) / 4)
    }
  }
  uv.needsUpdate = true
  g.clearGroups()
  return g
}

/* ------------------------------------------------------------------ */
/* the ground                                                           */
/* ------------------------------------------------------------------ */

/** grass lip for the front of the ground: 16×16, top of the dirt */
export function grassLipTexture() {
  const { cv, ctx } = canvas(16, 16)
  const r = rng(7)
  ctx.fillStyle = P.brown
  ctx.fillRect(0, 0, 16, 16)
  // grass cap with a scalloped edge dripping into the dirt
  const drip = [6, 7, 7, 6, 5, 5, 6, 7, 8, 8, 7, 6, 5, 5, 5, 6]
  for (let x = 0; x < 16; x++) {
    const d = drip[x]
    for (let y = 0; y < d; y++) {
      ctx.fillStyle = y === 0 ? P.signal : y < 2 ? P.signal : y >= d - 1 ? P.pine : P.green
      ctx.fillRect(x, y, 1, 1)
    }
    ctx.fillStyle = P.void
    ctx.fillRect(x, d, 1, 1)
  }
  // blades on the top row
  for (const x of [2, 9, 13]) {
    ctx.fillStyle = P.green
    ctx.fillRect(x, 2, 1, 1)
  }
  // dirt specks
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 16)
    const y = 10 + Math.floor(r() * 6)
    ctx.fillStyle = i % 2 ? P.orange : P.night
    ctx.fillRect(x, y, 1, 1)
  }
  return pixelTexture(cv, true)
}

/** dirt tile, repeats in both directions */
export function dirtTexture() {
  const { cv, ctx } = canvas(16, 16)
  const r = rng(11)
  ctx.fillStyle = P.brown
  ctx.fillRect(0, 0, 16, 16)
  // chunky stones: orange top-left highlight, night bottom-right
  const stones = [
    [2, 3],
    [10, 1],
    [6, 9],
    [13, 11],
    [1, 13],
  ]
  for (const [x, y] of stones) {
    ctx.fillStyle = P.orange
    ctx.fillRect(x, y, 2, 1)
    ctx.fillStyle = P.night
    ctx.fillRect(x + 1, y + 1, 2, 1)
  }
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = P.night
    ctx.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 1)
  }
  return pixelTexture(cv, true)
}

/** the walkable top of the ground */
export function grassTopTexture() {
  const { cv, ctx } = canvas(16, 16)
  const r = rng(5)
  ctx.fillStyle = P.green
  ctx.fillRect(0, 0, 16, 16)
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 3 === 0 ? P.pine : P.signal
    ctx.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 1)
  }
  return pixelTexture(cv, true)
}

/* ------------------------------------------------------------------ */
/* parallax backdrop                                                    */
/* ------------------------------------------------------------------ */

/**
 * Rolling hills strip: `w` px wide (tiles horizontally), `h` tall, bumps
 * as overlapping circles with an outline, a lit rim and a darker base band.
 */
export function hillsTexture(o: {
  w: number
  h: number
  seed: number
  bumps: number
  minR: number
  maxR: number
  base: number
  fill: string
  rim: string
  low: string
  outline: string
  spots?: string
}) {
  const { cv, ctx } = canvas(o.w, o.h)
  const r = rng(o.seed)
  const inside = new Uint8Array(o.w * o.h)
  const circles: [number, number, number][] = []
  for (let i = 0; i < o.bumps; i++) {
    const cx = ((i + 0.2 + r() * 0.6) / o.bumps) * o.w
    const rad = o.minR + r() * (o.maxR - o.minR)
    circles.push([cx, o.h - o.base, rad])
  }
  const hit = (x: number, y: number) => {
    if (y >= o.h - o.base) return true
    for (const [cx, cy, rad] of circles) {
      for (const dx of [-o.w, 0, o.w]) {
        const ex = x + 0.5 - (cx + dx)
        const ey = y + 0.5 - cy
        if (ex * ex + ey * ey < rad * rad) return true
      }
    }
    return false
  }
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) inside[y * o.w + x] = hit(x, y) ? 1 : 0
  const at = (x: number, y: number) => (y < 0 ? 0 : y >= o.h ? 1 : inside[y * o.w + (((x % o.w) + o.w) % o.w)])
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      if (!at(x, y)) {
        if (at(x, y + 1) || at(x - 1, y) || at(x + 1, y)) {
          ctx.fillStyle = o.outline
          ctx.fillRect(x, y, 1, 1)
        }
        continue
      }
      // depth below the surface
      let d = 0
      while (d < 6 && at(x, y - d - 1)) d++
      const leftEdge = !at(x - 1, y - 1) || !at(x - 2, y - 2)
      let c = o.fill
      if (d < 2 && leftEdge) c = o.rim
      else if (y > o.h - o.base * 0.55) c = o.low
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    }
  }
  if (o.spots) {
    for (let i = 0; i < o.w / 5; i++) {
      const x = Math.floor(r() * o.w)
      const y = Math.floor(o.h * 0.35 + r() * o.h * 0.4)
      if (at(x, y) && at(x, y - 3) && at(x + 1, y)) {
        ctx.fillStyle = o.spots
        ctx.fillRect(x, y, 2, 1)
      }
    }
  }
  return pixelTexture(cv, true)
}

/** puffy pixel cloud, white with a steel underside */
export function cloudTexture(seed: number, w = 40, h = 16) {
  const { cv, ctx } = canvas(w, h)
  const r = rng(seed)
  const puffs: [number, number, number][] = []
  const n = 4 + Math.floor(r() * 2)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const rad = h * (0.28 + 0.22 * Math.sin(Math.PI * t) + r() * 0.08)
    puffs.push([w * (0.12 + 0.76 * t), h - 3 - rad * 0.55, rad])
  }
  const inside = (x: number, y: number) => {
    if (y >= h - 2) return false
    if (y >= h - 5 && x > w * 0.1 && x < w * 0.9) return true
    return puffs.some(([cx, cy, rad]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < rad * rad)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      const under = !inside(x, y + 2) || y >= h - 4
      ctx.fillStyle = under ? P.steel : P.white
      ctx.fillRect(x, y, 1, 1)
    }
  }
  // soft cream band between the white top and steel underside
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++)
      if (inside(x, y) && !inside(x, y + 3) && inside(x, y + 1) && y < h - 4) {
        ctx.fillStyle = P.cream
        ctx.fillRect(x, y, 1, 1)
      }
  return pixelTexture(cv)
}

/** a 4-point sparkle, 7×7 */
export function sparkleTexture() {
  const rows = ['...w...', '...w...', '..wcw..', 'wwcycww', '..wcw..', '...w...', '...w...']
  const { cv, ctx } = canvas(7, 7)
  drawArt(ctx, rows, 0, 0, { w: P.white, c: P.cream, y: P.gold })
  return pixelTexture(cv)
}

/** a dashed halo ring behind the current power-up (rotates in steps), 34×34 */
export function haloTexture() {
  const S = 34
  const { cv, ctx } = canvas(S, S)
  const c = (S - 1) / 2
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - c,
        dy = y - c
      const r = Math.hypot(dx, dy)
      const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1
      let col: string | null = null
      // 8 crisp dashes: white heads with a gold tail
      if (r > 14.1 && r < 16.3) {
        const seg = (a * 8) % 1
        if (seg < 0.44) col = seg < 0.28 ? P.white : P.gold
      }
      if (col) {
        ctx.fillStyle = col
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
  return pixelTexture(cv)
}

/**
 * Jagged mountain range strip (tiles horizontally): lit left slopes, shaded
 * right slopes, snow on the high peaks and a hard outline.
 */
export function mountainsTexture(o: {
  w: number
  h: number
  seed: number
  peaks: number
  minH: number
  maxH: number
  lit: string
  fill: string
  snow: string
  outline: string
}) {
  const { cv, ctx } = canvas(o.w, o.h)
  const r = rng(o.seed)
  const peaks: { x: number; h: number; sl: number; sr: number }[] = []
  for (let i = 0; i < o.peaks; i++) {
    peaks.push({
      x: ((i + 0.15 + r() * 0.7) / o.peaks) * o.w,
      h: o.minH + r() * (o.maxH - o.minH),
      sl: 0.8 + r() * 0.5,
      sr: 0.7 + r() * 0.5,
    })
  }
  const surf = new Float32Array(o.w)
  const owner = new Int16Array(o.w)
  for (let x = 0; x < o.w; x++) {
    let best = 0
    let who = 0
    peaks.forEach((p, i) => {
      for (const dx of [-o.w, 0, o.w]) {
        const d = x + 0.5 - (p.x + dx)
        const hh = p.h - Math.abs(d) * (d < 0 ? p.sl : p.sr)
        if (hh > best) {
          best = hh
          who = d < 0 ? i + 1 : -(i + 1)
        }
      }
    })
    // a little jag so slopes read as rock, stepped every 3px
    surf[x] = Math.round(best + (Math.floor(x / 3) % 2 ? 0.6 : -0.4))
    owner[x] = who
  }
  for (let x = 0; x < o.w; x++) {
    const top = o.h - surf[x]
    const p = peaks[Math.abs(owner[x]) - 1]
    const snowline = o.h - (p ? p.h - Math.max(4, p.h * 0.22) : 0)
    for (let y = Math.max(0, Math.floor(top)); y < o.h; y++) {
      let c = owner[x] > 0 ? o.lit : o.fill
      if (y < snowline && p && p.h > o.minH + (o.maxH - o.minH) * 0.35) c = owner[x] > 0 ? o.snow : P.steel
      if (y === Math.floor(top)) c = o.outline
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return pixelTexture(cv, true)
}

/** oval drop shadow, pine on grass */
export function shadowTexture() {
  const rows = ['...qqqqqq...', '.qqqqqqqqqq.', 'qqqqqqqqqqqq', '.qqqqqqqqqq.', '...qqqqqq...']
  const { cv, ctx } = canvas(12, 5)
  drawArt(ctx, rows, 0, 0, { q: P.pine })
  return pixelTexture(cv)
}
