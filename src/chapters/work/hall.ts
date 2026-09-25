import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GeoBuilder, vertexFlat } from './geo'
import {
  THEMES,
  attractCell,
  drawAttract,
  drawCarpet,
  drawMarquees,
  drawNeonMark,
  drawNeonText,
  drawRadial,
  drawSkyline,
  fontsReady,
  marqueeUv,
} from './art'
import { screenMaterial, type ScreenUniforms } from './screen'

/*
 * THE ARCADE HALL. A row of upright cabinets on cosmic carpet in front of a
 * wall of tall windows (the Philadelphia skyline outside), neon in the
 * windows. Cabinet k stands at x = cabX(k), facing +z; the multi-game machine
 * closes the row.
 *
 * Draw calls: every static solid is ONE merged vertex-coloured toon mesh,
 * every static glow ONE unlit mesh; marquees share an atlas (one mesh); bulbs,
 * floor pools and coins are instanced; each CRT has its own shader (7).
 */

export const S = 2.9
export const CAB_W = 1.5
const T = 0.1 // side panel thickness
export const WALL_Z = -1.7
export const WALK_Z = 1.1
export const HARK_SCALE = 1.1

/** Side profile (z forward, y up), counter-clockwise. */
const PROFILE: [number, number][] = [
  [-0.55, 0],
  [0.42, 0],
  [0.42, 1.0],
  [0.62, 1.06],
  [0.62, 1.2],
  [0.26, 1.33],
  [0.16, 1.36],
  [0.02, 2.19],
  [0.3, 2.24],
  [0.3, 2.66],
  [-0.55, 2.66],
]
/** The black body between the side panels, set back a touch so the sides frame it. */
const BODY: [number, number][] = [
  [-0.53, 0.02],
  [0.39, 0.02],
  [0.39, 1.0],
  [0.58, 1.06],
  [0.58, 1.19],
  [0.24, 1.31],
  [0.14, 1.34],
  [0.0, 2.17],
  [0.27, 2.22],
  [0.27, 2.64],
  [-0.53, 2.64],
]
const SCREEN_A: [number, number] = [0.14, 1.34]
const SCREEN_B: [number, number] = [0.0, 2.17]
const PANEL_A: [number, number] = [0.58, 1.19]
const PANEL_B: [number, number] = [0.24, 1.31]
const MARQ_A: [number, number] = [0.27, 2.22]
const MARQ_B: [number, number] = [0.27, 2.64]
export const SCREEN_W = 1.2
export const SCREEN_H = 0.75

export interface Cabinet {
  x: number
  scale: number
  /** world matrix of the cabinet */
  matrix: THREE.Matrix4
  screen: THREE.Mesh
  uniforms: ScreenUniforms
  /** world-space centre of the screen */
  screenCenter: THREE.Vector3
  /** world-space top of the marquee (coin bursts spray from here) */
  top: THREE.Vector3
}

export interface Hall {
  root: THREE.Group
  cabs: Cabinet[]
  bulbs: THREE.InstancedMesh
  bulbsPerCab: number
  pools: THREE.InstancedMesh
  coins: THREE.InstancedMesh
  sparks: THREE.InstancedMesh
  signs: { mesh: THREE.Mesh; base: number; flicker: boolean }[]
  /** repaint canvas textures once the pixel fonts are in */
  repaint(): void
  textures: THREE.Texture[]
}

export const cabXOf = (k: number, n: number) => (k < n ? k * S : n * S + 0.35)

const X = new THREE.Vector3(1, 0, 0)
const UNIT = new THREE.BoxGeometry(1, 1, 1)
const _m = new THREE.Matrix4()
const _n = new THREE.Vector3()
const _d = new THREE.Vector3()
const _p = new THREE.Vector3()

/** Basis for a thing lying on profile segment a→b (x across, y = outward normal, z along -segment). */
function segBasis(a: [number, number], b: [number, number]) {
  const dz = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dz, dy)
  _d.set(0, dy / len, dz / len)
  _n.set(0, -dz / len, dy / len)
  return { len, dir: _d.clone(), n: _n.clone(), mid: new THREE.Vector3(0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2) }
}

/** A slab lying on segment a→b: width along x, `thick` outward, centred at x = cx, lifted `lift` off the surface. */
function slab(
  bld: GeoBuilder,
  parent: THREE.Matrix4,
  a: [number, number],
  b: [number, number],
  width: number,
  thick: number,
  color: string,
  o: { cx?: number; lift?: number; len?: number; along?: number; intensity?: number } = {},
) {
  const s = segBasis(a, b)
  const len = o.len ?? s.len
  const pos = s.mid.clone().addScaledVector(s.n, thick / 2 + (o.lift ?? 0)).addScaledVector(s.dir, o.along ?? 0)
  pos.x = o.cx ?? 0
  _m.makeBasis(X, s.n, s.dir.clone().negate())
  _m.scale(new THREE.Vector3(width, thick, len))
  _m.setPosition(pos)
  _m.premultiply(parent)
  bld.push(UNIT, color, _m, o.intensity ?? 1)
}

/** Extrude a profile polygon across x ∈ [x0 - depth, x0]. */
function extrudeProfile(bld: GeoBuilder, parent: THREE.Matrix4, pts: [number, number][], depth: number, x0: number, color: string) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
  // shape (sx, sy, sz) → cabinet (x = x0 - sz, y = sy, z = sx)
  _m.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0))
  _m.setPosition(x0, 0, 0)
  _m.premultiply(parent)
  bld.push(geo, color, _m)
  geo.dispose()
}

function buildCabinet(solid: GeoBuilder, glow: GeoBuilder, parent: THREE.Matrix4, k: number) {
  const t = THEMES[k]
  const W = CAB_W
  const house = k === THEMES.length - 1
  // side panels + black body
  extrudeProfile(solid, parent, PROFILE, T, W / 2, t.side)
  extrudeProfile(solid, parent, PROFILE, T, -W / 2 + T, t.side)
  extrudeProfile(solid, parent, BODY, W - 2 * T, W / 2 - T, P.void)
  // T-molding along every edge of both side panels
  for (let i = 0; i < PROFILE.length; i++) {
    const a = PROFILE[i]
    const b = PROFILE[(i + 1) % PROFILE.length]
    for (const side of [-1, 1]) {
      const cx = side * (W / 2 - T / 2)
      slab(solid, parent, a, b, T + 0.03, 0.03, t.trim, { cx })
    }
  }
  // side art: racing stripes and a diamond (the Hark diamond)
  const art = (pts: [number, number][], color: string, depth: number) => {
    extrudeProfile(solid, parent, pts, depth, W / 2 + depth, color)
    extrudeProfile(solid, parent, pts, depth, -W / 2, color)
  }
  art(
    [
      [-0.55, 0.28],
      [0.42, 0.62],
      [0.42, 0.76],
      [-0.55, 0.42],
    ],
    t.s1,
    0.012,
  )
  art(
    [
      [-0.55, 0.48],
      [0.42, 0.82],
      [0.42, 0.88],
      [-0.55, 0.54],
    ],
    t.s2,
    0.012,
  )
  art(
    [
      [-0.24, 1.56],
      [-0.02, 1.78],
      [-0.24, 2.0],
      [-0.46, 1.78],
    ],
    t.s1,
    0.012,
  )
  art(
    [
      [-0.24, 1.7],
      [-0.16, 1.78],
      [-0.24, 1.86],
      [-0.32, 1.78],
    ],
    t.s2,
    0.02,
  )
  const inner = W - 2 * T
  // control panel: coloured deck, lip stripe, joystick, buttons
  slab(solid, parent, PANEL_A, PANEL_B, inner, 0.02, t.side)
  slab(solid, parent, [0.58, 1.06], [0.58, 1.19], inner, 0.012, t.s1)
  const pb = segBasis(PANEL_A, PANEL_B)
  const onPanel = (u: number, x: number, lift: number) =>
    new THREE.Vector3(x, PANEL_A[1] + (PANEL_B[1] - PANEL_A[1]) * u, PANEL_A[0] + (PANEL_B[0] - PANEL_A[0]) * u).addScaledVector(pb.n, lift)
  {
    const base = onPanel(0.45, -0.34, 0.035)
    solid.box(0.13, 0.03, 0.13, base.x, base.y, base.z, P.void, { rx: Math.atan2(pb.n.z, pb.n.y), parent })
    solid.box(0.028, 0.17, 0.028, base.x, base.y + 0.09, base.z, P.steel, { parent })
    const ball = new THREE.IcosahedronGeometry(0.058, 1)
    _m.makeTranslation(base.x, base.y + 0.19, base.z).premultiply(parent)
    solid.push(ball, house ? P.signal : P.coral, _m)
    ball.dispose()
  }
  const btn = new THREE.CylinderGeometry(0.042, 0.042, 0.04, 8)
  const btnCols = house ? [P.signal, P.gold, P.signal] : [P.coral, P.gold, P.cyan]
  ;[0.02, 0.18, 0.34].forEach((x, i) => {
    const p = onPanel(0.5 - i * 0.06, x, 0.03)
    _m.makeBasis(X, pb.n, pb.dir.clone().negate()).setPosition(p).premultiply(parent)
    solid.push(btn, btnCols[i], _m)
  })
  btn.dispose()
  // screen surround: bezel + a darker frame hugging the glass
  slab(solid, parent, SCREEN_A, SCREEN_B, inner, 0.012, P.night)
  slab(solid, parent, SCREEN_A, SCREEN_B, SCREEN_W + 0.06, 0.018, P.void, { len: SCREEN_H + 0.06 })
  // coin door with two lit slots, kick-plate stripe
  slab(solid, parent, [0.39, 0.3], [0.39, 0.8], 0.38, 0.02, P.slate)
  slab(solid, parent, [0.39, 0.3], [0.39, 0.8], 0.3, 0.024, P.steel, { len: 0.12, along: 0.12 })
  for (const x of [-0.07, 0.07]) glow.box(0.045, 0.085, 0.02, x, 0.67, 0.425, P.coral, { parent, intensity: 1.35 })
  glow.box(0.12, 0.03, 0.02, 0, 0.45, 0.425, P.gold, { parent, intensity: 1.2 })
  slab(solid, parent, [0.39, 0.03], [0.39, 0.13], inner, 0.012, t.s1)
  // speaker grille slots under the marquee overhang
}

export async function buildHall(
  names: string[],
  mobile: boolean,
  tick: () => Promise<void>,
): Promise<Hall> {
  const root = new THREE.Group()
  const solid = new GeoBuilder(true)
  const glow = new GeoBuilder(false)
  const n = names.length - 1 // featured cabinets; the last name is the house machine
  const cabs: Cabinet[] = []
  const textures: THREE.Texture[] = []

  const attract = drawAttract(names)
  const marquees = drawMarquees(names)
  textures.push(attract.tex, marquees.tex)

  const marqGeos: THREE.BufferGeometry[] = []
  const screenGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H)
  for (let k = 0; k <= n; k++) {
    const x = cabXOf(k, n)
    const sc = k === n ? HARK_SCALE : 1
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc))
    buildCabinet(solid, glow, matrix, k)

    // CRT
    const sb = segBasis(SCREEN_A, SCREEN_B)
    const { mat, uniforms } = screenMaterial(attract.tex, attractCell(k), k * 1.37)
    const screen = new THREE.Mesh(screenGeo, mat)
    _m.makeBasis(X, sb.dir, sb.n).setPosition(sb.mid.clone().addScaledVector(sb.n, 0.021)).premultiply(matrix)
    screen.matrixAutoUpdate = false
    screen.matrix.copy(_m)
    root.add(screen)
    const screenCenter = new THREE.Vector3().setFromMatrixPosition(_m)

    // marquee (atlas quad)
    const mb = segBasis(MARQ_A, MARQ_B)
    const mg = new THREE.PlaneGeometry(CAB_W - 2 * T + 0.02, mb.len)
    const [u0, v0, u1, v1] = marqueeUv(k)
    const uv = mg.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0)
    _m.makeBasis(X, mb.dir, mb.n).setPosition(mb.mid.clone().addScaledVector(mb.n, 0.012)).premultiply(matrix)
    mg.applyMatrix4(_m)
    marqGeos.push(mg)

    cabs.push({ x, scale: sc, matrix, screen, uniforms, screenCenter, top: new THREE.Vector3(x, 2.66 * sc, 0.12 * sc) })
  }
  await tick()

  // ---------------------------------------------------------------- the room
  const x0 = -14
  const x1 = cabXOf(n, n) + 16
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  const WZ = WALL_Z
  // wainscot, neon strip, sill
  solid.box(len, 1.3, 0.3, cx, 0.65, WZ - 0.15, P.indigo)
  solid.box(len, 0.08, 0.36, cx, 1.26, WZ - 0.12, P.purple)
  // wainscot panels
  for (let x = x0 + 0.5; x < x1; x += 1.45) solid.box(1.1, 0.8, 0.04, x, 0.66, WZ + 0.01, P.night)
  glow.box(len, 0.045, 0.04, cx, 1.34, WZ + 0.02, P.cyan, { intensity: 1.25 })
  solid.box(len, 0.14, 0.42, cx, 1.44, WZ - 0.09, P.night)
  // skirting
  solid.box(len, 0.1, 0.34, cx, 0.05, WZ - 0.1, P.void)
  // pillars between windows, lintel above
  const pillarAt: number[] = []
  for (let x = cabXOf(0, n) - S / 2 - S * 5; x <= x1 + 0.1; x += S) pillarAt.push(x)
  for (const px of pillarAt) {
    solid.box(0.56, 2.9, 0.34, px, 2.95, WZ - 0.12, P.indigo)
    solid.box(0.66, 0.12, 0.4, px, 1.56, WZ - 0.1, P.purple)
    solid.box(0.66, 0.12, 0.4, px, 4.34, WZ - 0.1, P.purple)
  }
  solid.box(len, 5.6, 0.3, cx, 7.2, WZ - 0.15, P.night)
  solid.box(len, 0.14, 0.4, cx, 4.44, WZ - 0.1, P.purple)
  // window mullions (recessed)
  for (let i = 0; i < pillarAt.length - 1; i++) {
    const wx = (pillarAt[i] + pillarAt[i + 1]) / 2
    solid.box(0.06, 2.9, 0.06, wx, 2.95, WZ - 0.34, P.void)
    solid.box(S - 0.5, 0.06, 0.06, wx, 3.05, WZ - 0.34, P.void)
  }
  // end wall beyond the house machine
  solid.box(0.3, 9, 16, x1 + 0.15, 4.5, WZ + 8, P.night)
  glow.box(0.04, 0.045, 16, x1 - 0.02, 1.34, WZ + 8, P.cyan, { intensity: 1.25 })
  await tick()

  const solidMesh = new THREE.Mesh(solid.build(), vertexFlat())
  const glowMesh = new THREE.Mesh(glow.build(), vertexFlat())
  root.add(solidMesh, glowMesh)

  const marqMat = new THREE.MeshBasicMaterial({ map: marquees.tex, toneMapped: false })
  marqMat.color.setScalar(0.92)
  const marqMesh = new THREE.Mesh(mergeGeometries(marqGeos), marqMat)
  marqGeos.forEach(g => g.dispose())
  root.add(marqMesh)

  // ---------------------------------------------------------------- floor
  const carpet = drawCarpet()
  textures.push(carpet)
  const fz0 = WZ
  const fz1 = 16
  const floorGeo = new THREE.PlaneGeometry(len, fz1 - fz0)
  const TILE = 3.2
  carpet.repeat.set(len / TILE, (fz1 - fz0) / TILE)
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ map: carpet, color: new THREE.Color(0.95, 0.95, 0.95) }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(cx, 0, (fz0 + fz1) / 2)
  root.add(floor)

  // skyline outside (two parallax layers)
  const farTex = drawSkyline(true)
  const nearTex = drawSkyline(false)
  textures.push(farTex, nearTex)
  const skyMat = (tex: THREE.Texture) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false, depthWrite: true })
  const far = new THREE.Mesh(new THREE.PlaneGeometry(150, 150 * (128 / 512)), skyMat(farTex))
  far.position.set(cx + 6, -8 + (150 * 0.25) / 2, -34)
  root.add(far)
  if (!mobile) {
    const near = new THREE.Mesh(new THREE.PlaneGeometry(80, 80 * (96 / 512)), skyMat(nearTex))
    near.position.set(cx, -6.5 + (80 * (96 / 512)) / 2, -15)
    root.add(near)
  }
  await tick()

  // ---------------------------------------------------------------- neon signs
  // sign canvases are sized from the glyph metrics, so give the pixel face a moment
  await Promise.race([fontsReady(), new Promise<void>(r => setTimeout(r, 1500))])
  const signs: Hall['signs'] = []
  const repaints: (() => void)[] = [attract.paint, marquees.paint]
  const texs: THREE.Texture[] = []
  const addSign = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, glowK: number, flicker = false) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, toneMapped: false, depthWrite: false })
    mat.color.setScalar(glowK)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    m.position.set(x, y, z)
    root.add(m)
    signs.push({ mesh: m, base: glowK, flicker })
    texs.push(tex)
  }
  {
    const SY = 3.72
    const inWin = WZ - 0.2
    // hung in front of the windows, clear of the pillars (so a word may span one)
    const hang = WZ + 0.1
    const mark = drawNeonMark(P.signal)
    addSign(mark, 1.1, 1.1, cabXOf(0, n), SY, inWin, 1.3)
    const sign = (text: string, tube: string, h: number, x: number, y: number, z: number, flicker = false) => {
      const s = drawNeonText(text, tube, 40)
      repaints.push(s.paint)
      addSign(s.tex, h * s.aspect, h, x, y, z, 1.15, flicker)
    }
    // the hall's name, big on the wall above the windows (wide shots)
    sign('ARCADE', P.magenta, 0.8, (cabXOf(2, n) + cabXOf(3, n)) / 2 + 1.2, 5.15, WZ + 0.04, true)
    // over the gaps between machines, so they never sit behind Player 1's head
    sign('PLAY', P.cyan, 0.44, cabXOf(2, n) + S / 2, 3.3, hang)
    if (!mobile) sign('TURBO', P.coral, 0.44, cabXOf(4, n) + S / 2, 3.3, hang, true)
    sign('1UP', P.gold, 0.44, cabXOf(n, n) + 1.25, SY - 0.1, hang)
  }
  textures.push(...texs)

  // ---------------------------------------------------------------- bulbs (marquee chase lights)
  const PER = 24
  const bulbGeo = new THREE.BoxGeometry(0.042, 0.042, 0.03)
  const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), PER * cabs.length)
  const mb = segBasis(MARQ_A, MARQ_B)
  cabs.forEach((c, k) => {
    for (let i = 0; i < PER; i++) {
      const row = i < PER / 2 ? 0 : 1
      const j = row ? PER - 1 - i : i // top row left→right, bottom row right→left: a loop
      const x = -0.6 + (j % (PER / 2)) * (1.2 / (PER / 2 - 1))
      const y = row ? MARQ_A[1] + 0.028 : MARQ_B[1] - 0.028
      _p.set(x, y, MARQ_A[0]).addScaledVector(mb.n, 0.03).applyMatrix4(c.matrix)
      _m.makeTranslation(_p.x, _p.y, _p.z)
      bulbs.setMatrixAt(k * PER + i, _m)
      bulbs.setColorAt(k * PER + i, new THREE.Color(P.brown))
    }
  })
  bulbs.instanceMatrix.needsUpdate = true
  if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
  bulbs.frustumCulled = false
  root.add(bulbs)

  // ---------------------------------------------------------------- floor light pools
  const radial = drawRadial()
  textures.push(radial)
  const poolGeo = new THREE.PlaneGeometry(2.3, 1.7)
  poolGeo.rotateX(-Math.PI / 2)
  const pools = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ map: radial, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    cabs.length,
  )
  cabs.forEach((c, k) => {
    _m.makeTranslation(c.x, 0.01, 1.05 * c.scale)
    pools.setMatrixAt(k, _m)
    pools.setColorAt(k, new THREE.Color(0, 0, 0))
  })
  pools.instanceMatrix.needsUpdate = true
  pools.frustumCulled = false
  pools.renderOrder = 2
  root.add(pools)

  // ---------------------------------------------------------------- coins + sparkles
  // a chunky pixel coin: gold faces, orange rim, a slot line across the face
  const cb = new GeoBuilder(true)
  const cyl = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10)
  cb.push(cyl, P.gold, new THREE.Matrix4().makeRotationX(Math.PI / 2))
  cyl.dispose()
  cb.box(0.035, 0.13, 0.064, 0, 0, 0, P.orange)
  const coins = new THREE.InstancedMesh(cb.build(), vertexFlat(), 64)
  coins.frustumCulled = false
  coins.count = 0
  root.add(coins)
  const sparks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 0.075), new THREE.MeshBasicMaterial({ color: new THREE.Color(P.cream).multiplyScalar(1.9), toneMapped: false }), 48)
  sparks.frustumCulled = false
  sparks.count = 0
  root.add(sparks)

  return {
    root,
    cabs,
    bulbs,
    bulbsPerCab: PER,
    pools,
    coins,
    sparks,
    signs,
    textures,
    repaint() {
      for (const r of repaints) r()
      for (const t of [attract.tex, marquees.tex, ...texs]) t.needsUpdate = true
    },
  }
}

/** The radial texture is shared with Player 1's shadow. */
export { drawRadial }
