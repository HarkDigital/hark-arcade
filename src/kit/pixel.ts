import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PALETTE_HEX } from '../core/post'

/*
 * Hark Arcade pixel-art kit. The CRT pass (src/core/post.ts) pixelates and
 * palette-snaps the whole frame, so 3D reads as 16-bit art automatically —
 * this kit keeps everything in the same visual language:
 *
 *   P                         Hark-16 palette by name (hex strings)
 *   toon(color, opts)         cached MeshToonMaterial with a 3-step ramp: crisp
 *                             retro shading that survives palette snapping
 *   glow(color, strength)     emissive material that blooms like phosphor
 *   voxels(rows, map, opts)   build a voxel model from ASCII art layers
 *                             (one merged mesh per colour) — sprites in 3D
 *   sprite(rows, map, opts)   flat pixel-art sprite on a plane (nearest filter)
 *   pixelText(text, opts)     canvas pixel-font text as a plane (Silkscreen /
 *                             Pixelify), nearest filtered
 *
 * ASCII art: each row is a string; each char maps to a colour via `map`
 * (e.g. { g: P.signal, w: P.white }); '.' or ' ' is empty. For voxels, pass
 * an array of layers (front to back) or a single layer + depth.
 */

export const P = {
  void: PALETTE_HEX[0],
  night: PALETTE_HEX[1],
  indigo: PALETTE_HEX[2],
  purple: PALETTE_HEX[3],
  magenta: PALETTE_HEX[4],
  coral: PALETTE_HEX[5],
  orange: PALETTE_HEX[6],
  gold: PALETTE_HEX[7],
  cream: PALETTE_HEX[8],
  white: PALETTE_HEX[9],
  steel: PALETTE_HEX[10],
  slate: PALETTE_HEX[11],
  signal: PALETTE_HEX[12],
  green: PALETTE_HEX[13],
  pine: PALETTE_HEX[14],
  cyan: PALETTE_HEX[15],
  blue: PALETTE_HEX[16],
  brown: PALETTE_HEX[17],
}

let ramp: THREE.DataTexture | null = null
function toonRamp() {
  if (ramp) return ramp
  const data = new Uint8Array([90, 170, 255].flatMap(v => [v, v, v, 255]))
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  return ramp
}

const toonCache = new Map<string, THREE.MeshToonMaterial>()
/** Crisp 3-step toon shading in a palette colour (cached; don't mutate). */
export function toon(color: string, opts: { emissive?: string; emissiveIntensity?: number } = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}`
  let m = toonCache.get(key)
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: new THREE.Color(color),
      gradientMap: toonRamp(),
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    })
    toonCache.set(key, m)
  }
  return m
}

/** Unlit glowing colour that blooms (neon, screens, power-ups). */
export function glow(color: string, strength = 1.6) {
  const c = new THREE.Color(color).multiplyScalar(strength)
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
}

export type ColorMap = Record<string, string>

export interface VoxelOptions {
  /** size of one voxel in world units (default 0.1) */
  size?: number
  /** when a single layer is given: extrude it this many voxels deep */
  depth?: number
  /** centre the model on x/y (default true); z is centred on its depth */
  center?: boolean
  /** material factory per colour (default toon) */
  material?: (color: string) => THREE.Material
}

/**
 * Voxel model from ASCII layers. `rows` is either string[] (one layer,
 * extruded `depth` voxels) or string[][] (layers from front to back).
 * Returns a Group with one merged mesh per colour.
 */
export function voxels(rows: string[] | string[][], map: ColorMap, o: VoxelOptions = {}): THREE.Group {
  const size = o.size ?? 0.1
  const layers: string[][] = Array.isArray(rows[0]) ? (rows as string[][]) : Array.from({ length: o.depth ?? 1 }, () => rows as string[])
  const h = Math.max(...layers.map(l => l.length))
  const w = Math.max(...layers.flatMap(l => l.map(r => r.length)))
  const d = layers.length
  const byColor = new Map<string, THREE.BufferGeometry[]>()
  const cube = new THREE.BoxGeometry(size, size, size)
  const ox = o.center === false ? 0 : ((w - 1) * size) / 2
  const oy = o.center === false ? 0 : ((h - 1) * size) / 2
  const oz = ((d - 1) * size) / 2
  layers.forEach((layer, z) => {
    layer.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        const col = map[ch]
        if (!col) continue
        const g = cube.clone()
        g.translate(x * size - ox, (h - 1 - y) * size - oy, oz - z * size)
        let list = byColor.get(col)
        if (!list) byColor.set(col, (list = []))
        list.push(g)
      }
    })
  })
  const group = new THREE.Group()
  for (const [col, geos] of byColor) {
    const merged = mergeGeometries(geos)
    geos.forEach(g => g.dispose())
    group.add(new THREE.Mesh(merged, (o.material ?? toon)(col)))
  }
  cube.dispose()
  return group
}

/** Pixel-art sprite on a plane (world height = rows * pixelSize). */
export function sprite(rows: string[], map: ColorMap, o: { pixelSize?: number; glow?: number } = {}): THREE.Mesh {
  const h = rows.length
  const w = Math.max(...rows.map(r => r.length))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = map[row[x]]
      if (!col) continue
      ctx.fillStyle = col
      ctx.fillRect(x, y, 1, 1)
    }
  })
  const tex = new THREE.CanvasTexture(cv)
  tex.magFilter = tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  const ps = o.pixelSize ?? 0.1
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false })
  if (o.glow) mat.color.setScalar(o.glow)
  return new THREE.Mesh(new THREE.PlaneGeometry(w * ps, h * ps), mat)
}

/**
 * Pixel-font text on a plane. Draws with Silkscreen (or Pixelify Sans) at an
 * integer pixel size so glyphs stay crisp, then nearest-filters it.
 */
export function pixelText(
  text: string,
  o: { color?: string; font?: 'silkscreen' | 'pixelify'; px?: number; height?: number; glow?: number; bg?: string } = {},
): THREE.Mesh {
  const fam = o.font === 'pixelify' ? "700 FONTPX 'Pixelify Sans Variable', monospace" : "400 FONTPX 'Silkscreen', monospace"
  const px = o.px ?? 16
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  const font = fam.replace('FONTPX', `${px}px`)
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 4
  const hh = Math.ceil(px * 1.3)
  cv.width = w
  cv.height = hh
  const draw = () => {
    ctx.clearRect(0, 0, w, hh)
    if (o.bg) {
      ctx.fillStyle = o.bg
      ctx.fillRect(0, 0, w, hh)
    }
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.fillStyle = o.color ?? P.white
    ctx.fillText(text, 2, hh / 2 + 1)
  }
  draw()
  const tex = new THREE.CanvasTexture(cv)
  tex.magFilter = tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  // redraw once the web fonts are in
  document.fonts?.ready.then(() => {
    draw()
    tex.needsUpdate = true
  })
  const height = o.height ?? 0.4
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !o.bg, alphaTest: o.bg ? 0 : 0.4, toneMapped: false })
  if (o.glow) mat.color.setScalar(o.glow)
  return new THREE.Mesh(new THREE.PlaneGeometry((height * w) / hh, height), mat)
}
