import * as THREE from 'three'
import { P } from '../../kit/pixel'

/*
 * World-map geometry kit (chapter-local).
 *
 * Everything on the overworld is built from axis-aligned boxes whose faces
 * are painted with EXACT palette colours (a "ramp": top / front / shade), in
 * one unlit vertex-coloured mesh. That is how a pixel artist shades a tile:
 * a lit top, a mid front, a dark side, no gradients. Because the colours are
 * already Hark-16, the CRT pass snaps them cleanly (no dither mush), and the
 * whole static map is a single draw call.
 *
 * Objects (buildings, trees, the player) also get an inverted-hull outline in
 * void, so their silhouettes survive pixelation like hand-drawn sprites.
 */

/** [top, front (+z, and -x), shade (+x, back)] */
export type Ramp = readonly [string, string, string]

export const R = {
  grass: [P.green, P.pine, P.pine],
  sand: [P.gold, P.orange, P.orange],
  dirt: [P.brown, P.brown, P.brown],
  cliff: [P.brown, P.brown, P.night],
  stone: [P.steel, P.slate, P.slate],
  stoneDark: [P.slate, P.indigo, P.indigo],
  wood: [P.orange, P.brown, P.brown],
  plank: [P.gold, P.orange, P.brown],
  cream: [P.white, P.cream, P.steel],
  wall: [P.cream, P.cream, P.gold],
  roofRed: [P.coral, P.magenta, P.magenta],
  roofPurple: [P.magenta, P.purple, P.purple],
  roofBlue: [P.cyan, P.blue, P.blue],
  roofSlate: [P.steel, P.slate, P.indigo],
  canopy: [P.green, P.pine, P.pine],
  canopyDark: [P.pine, P.night, P.night],
  leaf: [P.signal, P.green, P.pine],
  trunk: [P.brown, P.brown, P.night],
  snow: [P.white, P.steel, P.slate],
  rock: [P.steel, P.slate, P.indigo],
  mountain: [P.steel, P.slate, P.indigo],
  mountainLow: [P.slate, P.indigo, P.night],
  tree: [P.pine, P.pine, P.night],
  treeHi: [P.green, P.pine, P.pine],
  conifer: [P.green, P.pine, P.night],
  cloud: [P.white, P.white, P.steel],
  gold: [P.gold, P.orange, P.orange],
  coin: [P.gold, P.gold, P.orange],
  metal: [P.white, P.steel, P.slate],
  dark: [P.night, P.void, P.void],
  void: [P.void, P.void, P.void],
  signal: [P.signal, P.signal, P.green],
  player: [P.signal, P.signal, P.green],
  face: [P.cream, P.cream, P.gold],
  indigo: [P.indigo, P.indigo, P.night],
  heart: [P.coral, P.coral, P.magenta],
  blueprint: [P.blue, P.blue, P.indigo],
  crane: [P.gold, P.orange, P.orange],
  glass: [P.cyan, P.cyan, P.blue],
  window: [P.gold, P.gold, P.orange],
  white: [P.white, P.white, P.steel],
  pad: [P.coral, P.magenta, P.purple],
  padClear: [P.gold, P.orange, P.brown],
  padStart: [P.steel, P.slate, P.indigo],
  flower: [P.coral, P.coral, P.magenta],
  flowerY: [P.gold, P.gold, P.orange],
  flowerW: [P.white, P.white, P.steel],
} as const satisfies Record<string, Ramp>

const colorCache = new Map<string, THREE.Color>()
/** hex → linear colour (vertex attributes are linear; output converts back). */
export function lin(hex: string) {
  let c = colorCache.get(hex)
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)))
  return c
}

/** the one unlit vertex-colour material every faceted mesh shares */
export const FACET = new THREE.MeshBasicMaterial({ vertexColors: true })
/** inverted-hull silhouette outline */
export const OUTLINE = new THREE.MeshBasicMaterial({ color: P.void, side: THREE.BackSide })

// face table: normal axis, sign, the 4 corners (unit cube, -0.5..0.5), colour slot
// slot: 0 top, 1 front, 2 shade
const FACES: { n: [number, number, number]; c: number[][]; slot: number }[] = [
  { n: [0, 1, 0], slot: 0, c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, 0, 1], slot: 1, c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [-1, 0, 0], slot: 1, c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [1, 0, 0], slot: 2, c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [0, 0, -1], slot: 2, c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [0, -1, 0], slot: 2, c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
]

const _v = new THREE.Vector3()

export class Builder {
  private pos: number[] = []
  private col: number[] = []
  private idx: number[] = []
  private opos: number[] = []
  private oidx: number[] = []
  /** applied to every box added while set (rotated parts) */
  matrix: THREE.Matrix4 | null = null
  /** outline thickness for boxes added with outline = true */
  outlineWidth = 0.035

  /**
   * Box with its centre at x/z and its BOTTOM at y, size w×h×d, painted with
   * a ramp. `outline` adds a void silhouette hull. `bottom` keeps the -y face
   * (only needed for floating things seen from below).
   */
  box(x: number, y: number, z: number, w: number, h: number, d: number, ramp: Ramp, outline = false, bottom = false) {
    const cx = x
    const cy = y + h / 2
    const cz = z
    for (let f = 0; f < FACES.length; f++) {
      if (f === 5 && !bottom) continue
      const face = FACES[f]
      const c = lin(ramp[face.slot])
      const base = this.pos.length / 3
      for (const k of face.c) {
        _v.set(cx + (k[0] * w) / 2, cy + (k[1] * h) / 2, cz + (k[2] * d) / 2)
        if (this.matrix) _v.applyMatrix4(this.matrix)
        this.pos.push(_v.x, _v.y, _v.z)
        this.col.push(c.r, c.g, c.b)
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    if (outline) {
      const o = this.outlineWidth
      const W = w + o * 2
      const H = h + o * 2
      const D = d + o * 2
      for (const face of FACES) {
        const base = this.opos.length / 3
        for (const k of face.c) {
          _v.set(cx + (k[0] * W) / 2, cy + (k[1] * H) / 2, cz + (k[2] * D) / 2)
          if (this.matrix) _v.applyMatrix4(this.matrix)
          this.opos.push(_v.x, _v.y, _v.z)
        }
        this.oidx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    return this
  }

  /** Cube-voxel art: rows (top → bottom) of chars mapped to ramps, one layer extruded `depth` voxels. */
  voxelArt(
    rows: string[],
    map: Record<string, Ramp>,
    o: { size: number; depth?: number; x?: number; y?: number; z?: number; outline?: boolean },
  ) {
    const s = o.size
    const depth = o.depth ?? 1
    const h = rows.length
    const w = Math.max(...rows.map(r => r.length))
    const ox = (o.x ?? 0) - ((w - 1) * s) / 2
    const oy = o.y ?? 0
    const z = o.z ?? 0
    rows.forEach((row, ry) => {
      // merge horizontal runs of the same char into one box (fewer faces)
      let x = 0
      while (x < row.length) {
        const ch = row[x]
        const ramp = map[ch]
        if (!ramp) {
          x++
          continue
        }
        let run = 1
        while (x + run < row.length && row[x + run] === ch) run++
        this.box(ox + (x + (run - 1) / 2) * s, oy + (h - 1 - ry) * s, z, run * s, s, depth * s, ramp, o.outline)
        x += run
      }
    })
    return this
  }

  get empty() {
    return this.pos.length === 0
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return g
  }

  outlineGeometry() {
    if (!this.opos.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.opos, 3))
    g.setIndex(this.oidx)
    g.computeBoundingSphere()
    return g
  }

  /** Mesh (+ outline hull as a child) ready to add. */
  mesh() {
    const m = new THREE.Mesh(this.geometry(), FACET)
    const og = this.outlineGeometry()
    if (og) {
      const o = new THREE.Mesh(og, OUTLINE)
      o.renderOrder = -1
      m.add(o)
    }
    return m
  }
}

/* ------------------------------------------------------------------ canvas sprites */

export function canvasTex(cv: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(cv)
  tex.magFilter = tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  return tex
}

/**
 * Pixel-font label with a hard void outline (8-way) and drop shadow, as a
 * camera-facing plane. Drawn at 1 canvas px per glyph pixel, so the CRT's own
 * pixel grid re-samples it like a sprite.
 */
export function labelMesh(
  text: string,
  o: {
    font?: 'display' | 'silkscreen'
    px?: number
    fg?: string
    outline?: string
    shadow?: string
    height: number
    /** draw the text on a little sign plate */
    plate?: { bg: string; border: string }
  },
) {
  const px = o.px ?? 16
  const fam = o.font === 'silkscreen' ? `400 ${px}px 'Silkscreen', monospace` : `700 ${px}px 'Hark Pixel', monospace`
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.font = fam
  const pad = o.plate ? 7 : 4
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + 2
  const h = Math.ceil(px * 1.25) + pad * 2
  cv.width = w
  cv.height = h
  const draw = () => {
    ctx.clearRect(0, 0, w, h)
    if (o.plate) {
      ctx.fillStyle = o.plate.border
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = o.plate.bg
      ctx.fillRect(2, 2, w - 4, h - 4)
    }
    ctx.font = fam
    ctx.textBaseline = 'middle'
    ctx.fontKerning = 'none'
    const x = pad
    const y = Math.round(h / 2) + 1
    const ol = o.outline ?? P.void
    if (o.shadow) {
      ctx.fillStyle = o.shadow
      ctx.fillText(text, x + 2, y + 3)
    }
    ctx.fillStyle = ol
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) if (dx || dy) ctx.fillText(text, x + dx, y + dy)
    ctx.fillStyle = o.fg ?? P.cream
    ctx.fillText(text, x, y)
    // hard-threshold the alpha so the glyphs stay pixel-crisp
    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0
    ctx.putImageData(img, 0, 0)
  }
  draw()
  const tex = canvasTex(cv)
  document.fonts?.ready.then(() => {
    draw()
    tex.needsUpdate = true
  })
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: false })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((o.height * w) / h, o.height), mat)
  mesh.renderOrder = 5
  return mesh
}

/**
 * A multi-frame pixel sprite (frames laid out horizontally in one texture).
 * `setFrame(i)` steps the UVs, like flipping a sprite sheet.
 */
export function sheetMesh(frames: string[][], map: Record<string, string>, pixelSize: number) {
  const fh = frames[0].length
  const fw = Math.max(...frames[0].map(r => r.length))
  const cv = document.createElement('canvas')
  cv.width = fw * frames.length
  cv.height = fh
  const ctx = cv.getContext('2d')!
  frames.forEach((rows, f) =>
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = map[row[x]]
        if (!c) continue
        ctx.fillStyle = c
        ctx.fillRect(f * fw + x, y, 1, 1)
      }
    }),
  )
  const tex = canvasTex(cv)
  tex.repeat.set(1 / frames.length, 1)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(fw * pixelSize, fh * pixelSize), mat)
  let cur = -1
  const setFrame = (i: number) => {
    const f = ((i % frames.length) + frames.length) % frames.length
    if (f === cur) return
    cur = f
    tex.offset.x = f / frames.length
  }
  setFrame(0)
  return { mesh, setFrame, material: mat }
}
