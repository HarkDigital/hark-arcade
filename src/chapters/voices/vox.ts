import * as THREE from 'three'
import { P } from '../../kit/pixel'

/*
 * Chapter-local voxel builder for the village.
 *
 * The kit's voxels() merges one mesh per colour and lights it with toon
 * steps; for a JRPG town we want palette-EXACT pixel art instead: every face
 * gets a hand-picked Hark-16 colour by the way it faces (tops catch the sun,
 * walls turned from it take a hue-shifted shade), baked into vertex colours
 * and drawn unlit. Only exposed faces are emitted, and whole scenes merge into
 * a single draw call.
 */

/** lighter palette neighbour: what a sunlit top face shows */
export const HI: Record<string, string> = {
  [P.void]: P.night,
  [P.night]: P.indigo,
  [P.indigo]: P.purple,
  [P.purple]: P.magenta,
  [P.magenta]: P.coral,
  [P.coral]: P.orange,
  [P.orange]: P.gold,
  [P.gold]: P.cream,
  [P.cream]: P.white,
  [P.white]: P.white,
  [P.steel]: P.cream,
  [P.slate]: P.steel,
  [P.signal]: P.signal,
  [P.green]: P.green,
  [P.pine]: P.green,
  [P.cyan]: P.white,
  [P.blue]: P.cyan,
  [P.brown]: P.orange,
}

/** darker, hue-shifted palette neighbour: faces turned from the light */
export const SH: Record<string, string> = {
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

/**
 * How faces are coloured:
 *  - 'world': by WORLD direction after the transform. top = HI, south (toward
 *    the camera) = base, east/west = SH, north/bottom = SH.
 *  - 'figure': by MODEL direction (sprites don't relight when they turn).
 *    top/front/back = base, sides = SH.
 *  - 'soft': like 'world' but tops keep the base colour (foliage).
 *  - 'roof': tops keep the base colour, every wall-like face takes the shade
 *    (stepped roofs read as shingle rows).
 *  - 'flat': every face the base colour.
 */
export type Ramp = 'world' | 'soft' | 'roof' | 'figure' | 'flat'

const linCache = new Map<string, THREE.Color>()
export function lin(hex: string) {
  let c = linCache.get(hex)
  if (!c) linCache.set(hex, (c = new THREE.Color(hex)))
  return c
}

/** Growable buffers several models are emitted into, then turned into one geometry. */
export class Buf {
  pos: number[] = []
  col: number[] = []
  idx: number[] = []
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: string) {
    const k = lin(color)
    const n = this.pos.length / 3
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z)
    for (let i = 0; i < 4; i++) this.col.push(k.r, k.g, k.b)
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3)
  }
  /** axis-aligned flat quad facing +y at height y */
  top(x0: number, z0: number, x1: number, z1: number, y: number, color: string) {
    _a.set(x0, y, z0)
    _b.set(x0, y, z1)
    _c.set(x1, y, z1)
    _d.set(x1, y, z0)
    this.quad(_a, _b, _c, _d, color)
  }
  /** vertical quad facing +z (south) spanning x0..x1, y0..y1 at z */
  south(x0: number, x1: number, y0: number, y1: number, z: number, color: string) {
    _a.set(x0, y0, z)
    _b.set(x1, y0, z)
    _c.set(x1, y1, z)
    _d.set(x0, y1, z)
    this.quad(_a, _b, _c, _d, color)
  }
  get empty() {
    return this.pos.length === 0
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    const n = this.pos.length / 3
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    return g
  }
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _n = new THREE.Vector3()
const _m3 = new THREE.Matrix3()

// cube faces: [dx, dy, dz, corners (unit cube, CCW from outside)]
const FACES: [number, number, number, number[][]][] = [
  [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [-1, 0, 0, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [0, 1, 0, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [0, 0, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
]

const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)

/** A sparse voxel grid in integer cells. */
export class Vox {
  cells = new Map<number, string>()
  private xs = new Map<number, [number, number, number]>()

  set(x: number, y: number, z: number, c: string | null | undefined) {
    const k = key(x, y, z)
    if (!c) {
      this.cells.delete(k)
      this.xs.delete(k)
      return
    }
    this.cells.set(k, c)
    this.xs.set(k, [x, y, z])
  }
  get(x: number, y: number, z: number) {
    return this.cells.get(key(x, y, z))
  }
  /** fill an inclusive box */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string | null) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c)
  }
  /** recolour existing cells in an inclusive box */
  paint(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (this.get(x, y, z)) this.set(x, y, z, c)
  }

  /**
   * Emit the exposed faces into `buf`. Cell (x,y,z) spans
   * [x,x+1]*size - origin; `m` (rotation/translation/scale) places the model.
   */
  emit(buf: Buf, size: number, o: { ramp?: Ramp; origin?: [number, number, number]; m?: THREE.Matrix4 } = {}) {
    const ramp = o.ramp ?? 'world'
    const [ox, oy, oz] = o.origin ?? [0, 0, 0]
    const m = o.m
    if (m) _m3.setFromMatrix4(m)
    for (const [k, c] of this.cells) {
      const [x, y, z] = this.xs.get(k)!
      for (const [dx, dy, dz, corners] of FACES) {
        if (this.cells.has(key(x + dx, y + dy, z + dz))) continue
        let color = c
        if (ramp !== 'flat') {
          _n.set(dx, dy, dz)
          if (m && ramp !== 'figure') _n.applyMatrix3(_m3).normalize()
          if (_n.y > 0.5) color = ramp === 'world' ? (HI[c] ?? c) : c
          else if (_n.y < -0.5) color = SH[c] ?? c
          else if (ramp === 'roof') color = SH[c] ?? c
          else if (ramp === 'world' || ramp === 'soft') color = _n.z > 0.5 ? c : SH[c] ?? c
          else color = Math.abs(_n.x) > 0.5 ? (SH[c] ?? c) : c
        }
        const v = [_a, _b, _c, _d]
        for (let i = 0; i < 4; i++) {
          const q = corners[i]
          v[i].set((x + q[0]) * size - ox, (y + q[1]) * size - oy, (z + q[2]) * size - oz)
          if (m) v[i].applyMatrix4(m)
        }
        buf.quad(_a, _b, _c, _d, color)
      }
    }
  }

  /** stand-alone geometry for this model */
  geometry(size: number, o: { ramp?: Ramp; origin?: [number, number, number]; m?: THREE.Matrix4 } = {}) {
    const b = new Buf()
    this.emit(b, size, o)
    return b.geometry()
  }
}

/** The one material every voxel mesh in the village shares (unlit vertex colours). */
let shared: THREE.MeshBasicMaterial | null = null
export function voxMaterial() {
  return (shared ??= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
}

/** Place-and-rotate helper: translate to (x,y,z), rotate by quarter turns about y. */
export function place(x: number, y: number, z: number, quarter = 0, scale = 1) {
  const m = new THREE.Matrix4().makeRotationY((quarter * Math.PI) / 2)
  if (scale !== 1) m.multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
  m.setPosition(x, y, z)
  return m
}
