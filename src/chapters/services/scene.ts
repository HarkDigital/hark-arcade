import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { rng } from '../../core/math'
import { BUSH_ART, BUSH_S_ART, COIN_ART, FLAG_ART, FLOWER_ARTS, HERO, ICONS, SIGN_ART } from './art'
import {
  artSprite,
  haloTexture,
  mountainsTexture,
  blockAtlas,
  blockGeometry,
  cloudTexture,
  dirtTexture,
  grassLipTexture,
  grassTopTexture,
  hillsTexture,
  shadowTexture,
  sparkleTexture,
  voxelGeometry,
  voxelMaterial,
} from './gfx'
import { BLOCK_SIZE, BLOCK_Y, GOAL_X, HERO_VOXEL, ITEM_VOXEL, N, SPACING, blockX } from './layout'

/*
 * The Power-Ups level, built once: a tiled ground, eleven ?-blocks (with a
 * few bricks for rhythm), rows of coins between them, bushes and flowers,
 * two parallax hill ranges and drifting clouds, the player (five voxel
 * frames sharing one mesh), the eleven power-up items, and the instanced
 * effects (coins, sparkles) the chapter animates.
 */

export const X0 = -40
export const X1 = GOAL_X + 60

export interface Level {
  root: THREE.Group
  /** ?-block meshes (bump via position.y; swap material when used) */
  blocks: THREE.Mesh[]
  qMats: THREE.MeshBasicMaterial[]
  usedMat: THREE.MeshBasicMaterial
  /** the player: one mesh, geometry swapped per frame */
  hero: THREE.Mesh
  heroFrames: Record<keyof typeof HERO, THREE.BufferGeometry>
  shadow: THREE.Mesh
  items: THREE.Mesh[]
  aura: THREE.Mesh
  /** coins: the rows first (coinRow.length), then the BURST coins */
  coins: THREE.InstancedMesh
  coinRow: { x: number; y: number }[]
  sparkles: THREE.InstancedMesh
  clouds: { mesh: THREE.InstancedMesh; index: number; x: number; y: number; z: number; scale: number; speed: number }[]
  flag: THREE.Mesh
}

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()

/** clouds drift right and wrap around the level (idle motion) */
export function driftClouds(level: Level, t: number) {
  const span = (X1 - X0) * 1.3
  for (const c of level.clouds) {
    const x = X0 - 20 + ((((c.x - X0 + 20 + t * c.speed) % span) + span) % span)
    _p.set(x, c.y, c.z)
    _s.setScalar(c.scale)
    c.mesh.setMatrixAt(c.index, _m.compose(_p, _q, _s))
  }
  for (const c of level.clouds) c.mesh.instanceMatrix.needsUpdate = true
}

export const BURST = 6
export const SPARKS = 28

export function buildLevel(mobile: boolean): Level {
  const root = new THREE.Group()
  const r = rng(42)
  const len = X1 - X0
  const midX = (X0 + X1) / 2

  /* ---------------- ground: grass top, grass lip, dirt ---------------- */
  const Z_FRONT = 1.6
  const Z_BACK = -3.2
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(len, Z_FRONT - Z_BACK),
    new THREE.MeshBasicMaterial({ map: grassTopTexture(), toneMapped: false }),
  )
  ;(top.material as THREE.MeshBasicMaterial).map!.repeat.set(len, Z_FRONT - Z_BACK)
  top.rotation.x = -Math.PI / 2
  top.position.set(midX, 0, (Z_FRONT + Z_BACK) / 2)
  root.add(top)
  const lipTex = grassLipTexture()
  lipTex.repeat.set(len, 1)
  const lip = new THREE.Mesh(new THREE.PlaneGeometry(len, 1), new THREE.MeshBasicMaterial({ map: lipTex, toneMapped: false }))
  lip.position.set(midX, -0.5, Z_FRONT)
  root.add(lip)
  const DIRT_H = 40
  const dirtTex = dirtTexture()
  dirtTex.repeat.set(len, DIRT_H)
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(len, DIRT_H), new THREE.MeshBasicMaterial({ map: dirtTex, toneMapped: false }))
  dirt.position.set(midX, -1 - DIRT_H / 2, Z_FRONT)
  root.add(dirt)

  /* ---------------- blocks ---------------- */
  const bgeo = blockGeometry(BLOCK_SIZE)
  // the "?" shimmers: the glyph steps white → cream → gold → cream
  const qMats = [P.white, P.cream, P.gold, P.cream].map(
    g => new THREE.MeshBasicMaterial({ map: blockAtlas('q', g), toneMapped: false }),
  )
  const usedMat = new THREE.MeshBasicMaterial({ map: blockAtlas('used'), toneMapped: false })
  const blocks: THREE.Mesh[] = []
  const brickSpots: { x: number; y: number }[] = []
  for (let k = 0; k < N; k++) {
    const b = new THREE.Mesh(bgeo, qMats[0])
    b.position.set(blockX(k), BLOCK_Y, 0)
    root.add(b)
    blocks.push(b)
    // rhythm: brick–?–brick, lone ?, ?–brick…
    const x = blockX(k)
    const pat = k % 3
    if (pat === 0) brickSpots.push({ x: x - BLOCK_SIZE, y: BLOCK_Y }, { x: x + BLOCK_SIZE, y: BLOCK_Y })
    else if (pat === 2) brickSpots.push({ x: x + BLOCK_SIZE, y: BLOCK_Y }, { x: x + 2 * BLOCK_SIZE, y: BLOCK_Y })
  }
  // a high brick shelf between some blocks, for a little level design
  for (let k = 1; k < N - 1; k += 4) {
    const x0 = blockX(k) + SPACING * 0.5 - BLOCK_SIZE
    for (let i = 0; i < 3; i++) brickSpots.push({ x: x0 + i * BLOCK_SIZE, y: BLOCK_Y + 2.4 })
  }
  const bricks = new THREE.InstancedMesh(
    bgeo,
    new THREE.MeshBasicMaterial({ map: blockAtlas('brick'), toneMapped: false }),
    brickSpots.length,
  )
  const m4 = new THREE.Matrix4()
  brickSpots.forEach((b, i) => {
    m4.makeTranslation(b.x, b.y, 0)
    bricks.setMatrixAt(i, m4)
  })
  bricks.computeBoundingSphere()
  root.add(bricks)

  /* ---------------- decor on the ground (instanced sprites) ---------------- */
  const scatter = (art: string[], px: number, spots: THREE.Vector3[]) => {
    const proto = artSprite(art, px, true)
    const im = new THREE.InstancedMesh(proto.geometry, proto.material, spots.length)
    spots.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y - px * 0.5, p.z)))
    im.computeBoundingSphere()
    root.add(im)
    return im
  }
  const bushes: THREE.Vector3[] = []
  const smallBushes: THREE.Vector3[] = []
  for (let x = X0 + 4; x < X1 - 4; x += 5 + r() * 7) (r() < 0.55 ? bushes : smallBushes).push(new THREE.Vector3(x, 0, -1.9 - r() * 0.8))
  scatter(BUSH_ART, 0.075, bushes)
  scatter(BUSH_S_ART, 0.075, smallBushes)
  const flowers: THREE.Vector3[][] = [[], []]
  for (let x = X0 + 2; x < X1 - 2; x += 2.2 + r() * 3.5) flowers[Math.floor(r() * 2)].push(new THREE.Vector3(x, 0, -0.9 - r() * 1.4))
  FLOWER_ARTS.forEach((art, i) => scatter(art, 0.07, flowers[i]))
  const sign = artSprite(SIGN_ART, 0.085, true)
  sign.position.set(-2.6, -0.12, -0.7)
  root.add(sign)
  const flag = artSprite(FLAG_ART, 0.16, true)
  flag.position.set(GOAL_X + 5.2, -0.08, -0.6)
  root.add(flag)

  /* ---------------- parallax backdrop ---------------- */
  const layer = (tex: THREE.Texture, tilePx: number, pxPerUnit: number, h: number, z: number, y0: number) => {
    const w = len * 2.2
    tex.repeat.set(w / (tilePx / pxPerUnit), 1)
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false, depthWrite: true }),
    )
    m.position.set(midX, y0 + h / 2, z)
    root.add(m)
    return m
  }
  // far range: blue peaks with snow, cool against the cyan sky
  const farTex = mountainsTexture({
    w: 240,
    h: 70,
    seed: 4,
    peaks: 6,
    minH: 24,
    maxH: 50,
    lit: P.blue,
    fill: P.indigo,
    snow: P.white,
    outline: P.indigo,
  })
  layer(farTex, 240, 2.6, 70 / 2.6, -46, -12)
  // near range: dark rolling hills, so the bright ground reads as foreground
  const midTex = hillsTexture({
    w: 256,
    h: 72,
    seed: 9,
    bumps: 7,
    minR: 14,
    maxR: 26,
    base: 34,
    fill: P.pine,
    rim: P.green,
    low: P.pine,
    outline: P.void,
    spots: P.green,
  })
  const midH = 72 / 6
  layer(midTex, 256, 6, midH, -17, -7.2)

  // clouds: one instanced mesh per cloud shape, drifting (see driftClouds)
  const clouds: Level['clouds'] = []
  const cloudTex = [cloudTexture(1), cloudTexture(2, 48, 18), cloudTexture(3, 32, 14)]
  const nClouds = mobile ? 12 : 18
  const perShape = Math.ceil(nClouds / 3)
  cloudTex.forEach((tex, shape) => {
    const img = tex.image as HTMLCanvasElement
    const im = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(img.width * 0.1, img.height * 0.1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false }),
      perShape,
    )
    im.frustumCulled = false
    root.add(im)
    for (let i = 0; i < perShape; i++) {
      const j = shape + i * 3
      const z = -44 - r() * 30
      clouds.push({
        mesh: im,
        index: i,
        x: X0 + (j / nClouds) * len * 1.1 + r() * 8,
        y: 9 + r() * 11,
        z,
        scale: 1 + (-z - 44) / 40,
        speed: 0.25 + r() * 0.35,
      })
    }
  })

  /* ---------------- the player ---------------- */
  const heroFrames = {} as Record<keyof typeof HERO, THREE.BufferGeometry>
  for (const k of Object.keys(HERO) as (keyof typeof HERO)[]) {
    heroFrames[k] = voxelGeometry(HERO[k], { size: HERO_VOXEL, depth: 4, anchor: 'bottom' })
  }
  const hero = new THREE.Mesh(heroFrames.idle, voxelMaterial())
  root.add(hero)
  const shadowTex = shadowTexture()
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.55),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, alphaTest: 0.5, toneMapped: false, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.01
  root.add(shadow)

  /* ---------------- the power-ups ---------------- */
  const items = ICONS.map(art => {
    const m = new THREE.Mesh(voxelGeometry(art, { size: ITEM_VOXEL, depth: 3 }), voxelMaterial())
    m.visible = false
    root.add(m)
    return m
  })
  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, alphaTest: 0.5, toneMapped: false, depthWrite: false }),
  )
  aura.visible = false
  root.add(aura)

  /* ---------------- coins (rows + burst) ---------------- */
  const coinRow: { x: number; y: number }[] = []
  for (let k = -1; k < N - 1; k++) {
    const a = k < 0 ? 1.6 : blockX(k) + 1.6
    const b = blockX(k + 1) - 1.6
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4
      coinRow.push({ x: a + (b - a) * t, y: 0.95 + Math.sin(Math.PI * t) * 0.45 })
    }
  }
  const coinGeo = voxelGeometry(COIN_ART, { size: 0.075, depth: 2 })
  const coins = new THREE.InstancedMesh(coinGeo, voxelMaterial(), coinRow.length + BURST)
  coins.frustumCulled = false
  root.add(coins)

  /* ---------------- sparkles ---------------- */
  const sparkles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.46, 0.46),
    new THREE.MeshBasicMaterial({ map: sparkleTexture(), transparent: true, alphaTest: 0.5, toneMapped: false, depthWrite: false }),
    SPARKS,
  )
  sparkles.frustumCulled = false
  root.add(sparkles)

  return { root, blocks, qMats, usedMat, hero, heroFrames, shadow, items, aura, coins, coinRow, sparkles, clouds, flag }
}
