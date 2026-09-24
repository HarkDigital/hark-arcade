import * as THREE from 'three'
import { logoGeometry, logoParts } from '../../logo/logo'
import { P, toon } from '../../kit/pixel'

/*
 * The Hark mark as a 16-bit GAME LOGO:
 *   - chunky extrusion, toon-shaded signal green face with a gold bevel trim
 *     (the bevel catches the key light like a pixel-art button edge)
 *   - a void outline (offset contours) and a hard purple drop block behind,
 *     like a title logo printed on the cabinet marquee
 *   - a title "shine" band that sweeps across the face now and then
 *   - the centre diamond is a faceted, glowing cyan gem that spins on
 *     stepped frames
 *
 * Geometry is normalized so the mark is ~1 unit tall and centred on the
 * origin; `root` is placed/scaled by the chapter, `body` takes bob/squash.
 */

const OUTLINE = 0.034
const DROP = new THREE.Vector3(0.045, -0.055, -0.2)

/** Offset a closed contour by d (outward for CCW outers, into holes for CW holes). */
function offsetContour(pts: THREE.Vector2[], d: number) {
  const src = pts.slice()
  if (src.length > 2 && src[0].distanceTo(src[src.length - 1]) < 1e-6) src.pop()
  const n = src.length
  const out: THREE.Vector2[] = []
  const nrm = (a: THREE.Vector2, b: THREE.Vector2) => {
    const dx = b.x - a.x, dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    return new THREE.Vector2(dy / l, -dx / l)
  }
  for (let i = 0; i < n; i++) {
    const p = src[i], a = src[(i - 1 + n) % n], b = src[(i + 1) % n]
    const n1 = nrm(a, p), n2 = nrm(p, b)
    const m = n1.clone().add(n2)
    if (m.lengthSq() < 1e-8) m.copy(n1)
    m.normalize()
    const k = d / Math.max(0.35, m.dot(n1))
    out.push(new THREE.Vector2(p.x + m.x * k, p.y + m.y * k))
  }
  return out
}

function offsetShapes(shapes: THREE.Shape[], d: number) {
  return shapes.map(s => {
    const { shape, holes } = s.extractPoints(1)
    const o = new THREE.Shape(offsetContour(shape, d))
    for (const h of holes) o.holes.push(new THREE.Path(offsetContour(h, d)))
    return o
  })
}

/** An octahedral gem with baked facet colours (unlit, so it glows in exact palette colours). */
export function gemGeometry(hw: number, hh: number, depth: number) {
  const T = new THREE.Vector3(0, hh, 0), B = new THREE.Vector3(0, -hh, 0)
  const L = new THREE.Vector3(-hw, 0, 0), R = new THREE.Vector3(hw, 0, 0)
  const F = new THREE.Vector3(0, 0, depth), K = new THREE.Vector3(0, 0, -depth)
  const white = new THREE.Color(P.white), cyan = new THREE.Color(P.cyan), blue = new THREE.Color(P.blue), steel = new THREE.Color(P.steel)
  const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Color][] = [
    [F, T, L, white],
    [F, R, T, cyan],
    [F, B, R, blue],
    [F, L, B, cyan],
    [K, L, T, cyan],
    [K, T, R, steel],
    [K, R, B, cyan],
    [K, B, L, blue],
  ]
  const pos: number[] = []
  const col: number[] = []
  for (const [a, b, c, k] of faces) {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

export class Mark {
  root = new THREE.Group()
  body = new THREE.Group()
  gem: THREE.Mesh
  gemMat: THREE.MeshBasicMaterial
  /** gem centre in body space */
  gemPos = new THREE.Vector3()
  /** top of the mark in body space */
  top = 0.5
  shine = { value: -9 }

  constructor() {
    const parts = logoParts()
    const loops = [...parts.loopA, ...parts.loopB]
    const depth = 0.2

    // face: a private toon clone with the title shine injected
    const face = toon(P.signal).clone()
    const shine = this.shine
    face.onBeforeCompile = shader => {
      shader.uniforms.uShine = shine
      shader.vertexShader = 'varying vec3 vObj;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;')
      shader.fragmentShader =
        'uniform float uShine;\nvarying vec3 vObj;\n' +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
  float sd = (vObj.x + vObj.y) * 0.7071 - uShine;
  float band = step(abs(sd), 0.045) + step(abs(sd + 0.12), 0.018);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), clamp(band, 0.0, 1.0) * step(0.0, vObj.z) * 0.92);`,
        )
    }
    face.customProgramCacheKey = () => 'hero-mark-face'
    const trim = toon(P.gold)
    const bodyGeo = logoGeometry({ shapes: loops, depth, bevel: true, bevelSize: 0.016, bevelThickness: 0.03, curveSegments: 18 })
    const bodyMesh = new THREE.Mesh(bodyGeo, [face, trim])
    this.body.add(bodyMesh)

    // void outline + purple drop block (flat, behind the body)
    const all = [...loops, ...parts.diamond]
    const outlineGeo = new THREE.ShapeGeometry(offsetShapes(all, OUTLINE + 0.016), 12)
    const outline = new THREE.Mesh(outlineGeo, new THREE.MeshBasicMaterial({ color: P.void, toneMapped: false }))
    outline.position.z = -depth / 2 - 0.045
    this.body.add(outline)
    const drop = new THREE.Mesh(outlineGeo, new THREE.MeshBasicMaterial({ color: P.purple, toneMapped: false }))
    drop.position.copy(DROP).add(new THREE.Vector3(0, 0, -depth / 2))
    this.body.add(drop)

    // the diamond → a spinning gem
    const box = new THREE.Box2()
    for (const s of parts.diamond) for (const p of s.getPoints(8)) box.expandByPoint(p)
    const c = box.getCenter(new THREE.Vector2())
    const size = box.getSize(new THREE.Vector2())
    this.gemMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    this.gem = new THREE.Mesh(gemGeometry(size.x * 0.56, size.y * 0.56, size.x * 0.5), this.gemMat)
    this.gem.position.set(c.x, c.y, 0.04)
    this.gemPos.copy(this.gem.position)
    this.body.add(this.gem)

    bodyGeo.computeBoundingBox()
    this.top = bodyGeo.boundingBox!.max.y
    this.root.add(this.body)
  }
}
