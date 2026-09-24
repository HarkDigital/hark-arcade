import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { P } from '../../kit/pixel'

/*
 * Geometry accumulator: every static solid in the hall is pushed here with
 * per-vertex colour and merged into ONE mesh (one draw call for all the
 * cabinets, the wall, the windows…).
 *
 * Shading is BAKED like a pixel artist would: each face takes a colour from a
 * hand-picked, hue-shifted palette ramp (shadow / base / light) by which way
 * it faces — tops catch the light, fronts and the key side are the base
 * colour, the far side and undersides drop to the shadow colour. Every colour
 * is already a Hark-16 entry, so the CRT pass snaps it without dither mud.
 */

/** [shadow, base, light] per palette colour */
const RAMPS: Record<string, [string, string, string]> = {
  [P.void]: [P.void, P.void, P.night],
  [P.night]: [P.void, P.night, P.indigo],
  [P.indigo]: [P.night, P.indigo, P.slate],
  [P.purple]: [P.indigo, P.purple, P.magenta],
  [P.magenta]: [P.purple, P.magenta, P.coral],
  [P.coral]: [P.magenta, P.coral, P.orange],
  [P.orange]: [P.coral, P.orange, P.gold],
  [P.gold]: [P.orange, P.gold, P.cream],
  [P.cream]: [P.steel, P.cream, P.white],
  [P.white]: [P.steel, P.white, P.white],
  [P.steel]: [P.slate, P.steel, P.cream],
  [P.slate]: [P.indigo, P.slate, P.steel],
  [P.signal]: [P.green, P.signal, P.signal],
  [P.green]: [P.pine, P.green, P.signal],
  [P.pine]: [P.night, P.pine, P.green],
  [P.cyan]: [P.blue, P.cyan, P.white],
  [P.blue]: [P.indigo, P.blue, P.cyan],
  [P.brown]: [P.night, P.brown, P.orange],
}
const rampCache = new Map<string, [THREE.Color, THREE.Color, THREE.Color]>()
function ramp(hex: string) {
  const key = hex.toLowerCase()
  let r = rampCache.get(key)
  if (!r) {
    const src = RAMPS[key] ?? [key, key, key]
    r = [new THREE.Color(src[0]), new THREE.Color(src[1]), new THREE.Color(src[2])]
    rampCache.set(key, r)
  }
  return r
}

/** which way the light comes from, horizontally (front-left) */
const KEY_H = new THREE.Vector3(-0.42, 0, 0.9).normalize()

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _c = new THREE.Color()
const _n = new THREE.Vector3()

export class GeoBuilder {
  private list: THREE.BufferGeometry[] = []
  /** bake palette-ramp shading from face normals (false: flat colour × intensity, for glows) */
  constructor(private shade = true) {}

  /** Add `geo` (not consumed) transformed by `matrix`. */
  push(geo: THREE.BufferGeometry, color: string, matrix: THREE.Matrix4, intensity = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    g.applyMatrix4(matrix)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    const nor = g.attributes.normal as THREE.BufferAttribute
    const r = ramp(color)
    for (let i = 0; i < n; i++) {
      let c: THREE.Color
      if (this.shade) {
        _n.fromBufferAttribute(nor, i)
        if (_n.y > 0.62) c = r[2]
        else if (_n.y < -0.5 || _n.dot(KEY_H) < -0.05) c = r[0]
        else c = r[1]
      } else c = _c.set(color).multiplyScalar(intensity)
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    this.list.push(g)
  }

  /** Axis-aligned (then optionally rotated) box, sizes w×h×d centred at x,y,z, in `parent` space. */
  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    o: { rx?: number; ry?: number; rz?: number; parent?: THREE.Matrix4; intensity?: number } = {},
  ) {
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d))
    if (o.parent) _m.premultiply(o.parent)
    this.push(UNIT_BOX, color, _m, o.intensity ?? 1)
  }

  get empty() {
    return this.list.length === 0
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.list, false)
    for (const g of this.list) g.dispose()
    this.list = []
    merged.computeBoundingSphere()
    return merged
  }
}

/** Unlit, vertex-coloured: for baked-shaded solids (and glows, whose colours go > 1 so they bloom). */
export function vertexFlat() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
}
