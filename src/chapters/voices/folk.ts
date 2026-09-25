import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { PLAYER1 } from '../../kit/player1'
import { Vox, voxMaterial } from './vox'

/*
 * Villagers: chibi voxel figures in the Hark-16 palette, built from a small
 * set of parameters (hair, outfit, hat, one prop) so each client reads as a
 * distinct NPC. Legs and arms are separate pivots, posed in stepped frames
 * like a sprite sheet (walk cycle, wave, busy, talk). A 20x20 pixel portrait
 * of the same look goes in the dialogue window.
 *
 * Cell space: 1 cell = S world units. Feet at y = 0, centred on x/z = 0.
 * Head 8 x 7 x 6 (y 7..13), torso 6 x 4 x 4 (y 3..6), legs 2 x 3 x 2, arms 1 x 4 x 2.
 * The face is on +z (the model's front).
 */

export const S = 0.092

export type Hair = 'short' | 'long' | 'bun' | 'pony' | 'bob' | 'spiky' | 'hood'
export type Hat = 'hardhat' | 'cap' | 'straw' | 'band' | 'goggles' | 'phones' | 'none'
export type Extra = 'apron' | 'stripes' | 'vest' | 'cape' | 'belt' | 'book' | 'collar' | 'tablet' | 'hood' | 'glasses'

export interface Look {
  skin: string
  hair: string
  style: Hair
  shirt: string
  pants: string
  shoes: string
  hat: Hat
  hatA?: string
  hatB?: string
  extras?: Extra[]
  /** colour of the apron / vest / cape / book… */
  kit?: string
  kit2?: string
  /** shorts: bare knees */
  shorts?: boolean
  /** portrait backdrop */
  bg: string
  /** eye / blush colours (default void / coral) */
  eyes?: string
  cheeks?: string
  /** 'hood' style: the shaded inside of the hood that frames the face */
  lining?: string
}

const SKIN = P.cream

/**
 * Player 1, from the shared spec (kit/player1.ts): signal-green hoodie with
 * the hood up, void headphone band + white cups over it, cream face, indigo
 * trousers, white trainers.
 */
export const PLAYER_LOOK: Look = {
  skin: PLAYER1.face,
  eyes: PLAYER1.eyes,
  cheeks: PLAYER1.cheeks,
  hair: PLAYER1.hood,
  lining: PLAYER1.hoodShade,
  style: 'hood',
  shirt: PLAYER1.hood,
  pants: PLAYER1.pants,
  shoes: PLAYER1.shoes,
  hat: 'phones',
  hatA: PLAYER1.phonesBand,
  hatB: PLAYER1.phonesCup,
  extras: ['hood'],
  bg: P.pine,
}

/** one look per testimonial, in content order */
export const LOOKS: Look[] = [
  // Fabbri Builders: hard hat + hi-vis vest
  { skin: SKIN, hair: P.brown, style: 'short', shirt: P.white, pants: P.blue, shoes: P.brown, hat: 'hardhat', hatA: P.gold, extras: ['vest', 'belt'], kit: P.orange, bg: P.indigo },
  // Shriver's Salt Water Taffy: candy-striped apron, hair in a bun
  { skin: SKIN, hair: P.gold, style: 'bun', shirt: P.magenta, pants: P.purple, shoes: P.brown, hat: 'none', extras: ['stripes'], kit: P.cream, kit2: P.coral, bg: P.purple },
  // CrossFit Off The Grid: headband, tank, shorts
  { skin: SKIN, hair: P.brown, style: 'pony', shirt: P.cyan, pants: P.night, shoes: P.white, hat: 'band', hatA: P.coral, shorts: true, bg: P.pine },
  // Bellview Winery: straw hat, wine-coloured shirt, apron
  { skin: SKIN, hair: P.brown, style: 'short', shirt: P.purple, pants: P.brown, shoes: P.brown, hat: 'straw', hatA: P.gold, hatB: P.purple, extras: ['apron'], kit: P.cream, bg: P.night },
  // PEG Glass: goggles, work apron
  { skin: SKIN, hair: P.night, style: 'long', shirt: P.blue, pants: P.night, shoes: P.brown, hat: 'goggles', hatA: P.night, hatB: P.cyan, extras: ['apron'], kit: P.steel, bg: P.indigo },
  // Our Lady of Mercy Academy: cardigan, collar, a book
  { skin: SKIN, hair: P.orange, style: 'bob', shirt: P.indigo, pants: P.night, shoes: P.brown, hat: 'none', extras: ['collar', 'book', 'glasses'], kit: P.coral, bg: P.blue },
  // The Home Hero: cap, cape, tool belt
  { skin: SKIN, hair: P.brown, style: 'short', shirt: P.white, pants: P.blue, shoes: P.brown, hat: 'cap', hatA: P.blue, hatB: P.indigo, extras: ['cape', 'belt'], kit: P.coral, bg: P.slate },
  // ProviderSoft: blazer, glasses, tablet
  { skin: SKIN, hair: P.brown, style: 'long', shirt: P.white, pants: P.night, shoes: P.void, hat: 'none', extras: ['vest', 'tablet', 'glasses'], kit: P.magenta, bg: P.purple },
]

/* ------------------------------------------------------------------ build */

function buildBody(l: Look) {
  const v = new Vox()
  const ex = new Set(l.extras ?? [])
  // torso
  v.box(-3, 3, -2, 2, 6, 1, l.shirt)
  if (ex.has('vest')) {
    v.paint(-3, 3, -2, -3, 6, 1, l.kit!)
    v.paint(2, 3, -2, 2, 6, 1, l.kit!)
    v.paint(-3, 3, 1, -2, 6, 1, l.kit!)
    v.paint(1, 3, 1, 2, 6, 1, l.kit!)
    v.paint(-3, 3, -2, 2, 6, -2, l.kit!)
  }
  if (ex.has('collar')) v.paint(-2, 6, 1, 1, 6, 1, P.white)
  if (ex.has('belt')) {
    v.paint(-3, 3, -2, 2, 3, 1, P.brown)
    v.paint(-1, 3, 1, 0, 3, 1, P.gold)
  }
  if (ex.has('apron') || ex.has('stripes')) {
    for (let x = -2; x <= 1; x++) {
      const c = ex.has('stripes') && (x & 1) === 0 ? l.kit2! : l.kit!
      v.box(x, 3, 2, x, 5, 2, c)
    }
    v.box(-1, 6, 2, 0, 6, 2, l.kit!)
  }
  if (ex.has('hood')) {
    // hoodie: drawstrings and a pouch pocket in front
    v.set(-1, 5, 2, P.white)
    v.set(0, 5, 2, P.white)
    v.box(-1, 3, 2, 0, 3, 2, l.shirt)
  }
  if (ex.has('cape')) {
    v.box(-3, 2, -3, 2, 6, -3, l.kit!)
    v.box(-3, 1, -3, -2, 1, -3, l.kit!)
    v.box(1, 1, -3, 2, 1, -3, l.kit!)
    v.box(-3, 6, 2, -3, 6, 2, l.kit!)
    v.box(2, 6, 2, 2, 6, 2, l.kit!)
  }
  if (ex.has('book')) {
    v.box(-1, 3, 2, 2, 5, 3, l.kit!)
    v.box(-1, 5, 2, 2, 5, 3, P.cream)
  }
  if (ex.has('tablet')) {
    v.box(-2, 4, 2, 1, 5, 2, P.steel)
    v.box(-1, 4, 3, 0, 5, 3, P.cyan)
  }

  // head
  v.box(-4, 7, -3, 3, 13, 2, l.skin)
  // eyes (2 tall), blush
  const eyes = l.eyes ?? P.void
  const cheeks = l.cheeks ?? P.coral
  v.box(-2, 9, 2, -2, 10, 2, eyes)
  v.box(1, 9, 2, 1, 10, 2, eyes)
  v.set(-3, 8, 2, cheeks)
  v.set(2, 8, 2, cheeks)
  if (ex.has('glasses')) {
    v.box(-3, 11, 2, -1, 11, 2, P.night)
    v.box(0, 11, 2, 2, 11, 2, P.night)
  }

  // hair
  const h = l.hair
  const style = l.style
  v.box(-4, 13, -3, 3, 13, 2, h) // crown
  v.box(-4, 8, -3, 3, 13, -3, h) // back
  v.box(-4, 10, -3, -4, 13, 2, h) // sides
  v.box(3, 10, -3, 3, 13, 2, h)
  v.box(-4, 12, 2, 3, 12, 2, h) // fringe
  v.set(-4, 11, 2, h)
  v.set(3, 11, 2, h)
  v.set(-1, 11, 2, h)
  if (style === 'hood') {
    // hood up all round, its shaded lining framing the face (no hair shows),
    // a little point at the back
    const lining = l.lining ?? h
    v.box(-4, 7, -3, -4, 13, 2, h)
    v.box(3, 7, -3, 3, 13, 2, h)
    v.box(-3, 13, -3, 2, 14, 2, h)
    v.box(-2, 15, -2, 1, 15, -1, h)
    v.box(-4, 12, 2, 3, 13, 2, h)
    v.box(-3, 12, 2, 2, 12, 2, lining)
    v.set(-3, 11, 2, lining)
    v.set(2, 11, 2, lining)
    v.box(-2, 11, 2, 1, 11, 2, l.skin)
    v.set(-4, 11, 2, h)
    v.set(3, 11, 2, h)
    // the rim stands a cell proud of the face
    v.box(-4, 7, 3, 3, 7, 3, h)
    v.box(-4, 8, 3, -4, 12, 3, h)
    v.box(3, 8, 3, 3, 12, 3, h)
    v.box(-3, 13, 3, 2, 13, 3, h)
  }
  if (style === 'spiky') {
    for (const [x, z] of [[-3, -2], [0, -1], [2, 1], [-2, 1], [1, -3], [-4, 0]]) v.set(x, 14, z, h)
    v.set(2, 11, 2, h)
    v.set(-3, 11, 2, h)
  }
  if (style === 'long') {
    v.box(-4, 3, -3, 3, 8, -3, h)
    v.box(-4, 5, -2, -4, 10, 1, h)
    v.box(3, 5, -2, 3, 10, 1, h)
  }
  if (style === 'bob') {
    v.box(-4, 7, -3, -4, 10, 1, h)
    v.box(3, 7, -3, 3, 10, 1, h)
    v.box(-4, 7, -3, 3, 8, -3, h)
  }
  if (style === 'bun') v.box(-1, 14, -2, 0, 15, -1, h)
  if (style === 'pony') {
    v.box(-1, 11, -4, 0, 12, -4, h)
    v.box(-1, 6, -5, 0, 11, -5, h)
  }

  // hats
  const a = l.hatA ?? P.white
  const b = l.hatB ?? P.night
  if (l.hat === 'hardhat') {
    v.box(-4, 13, -3, 3, 14, 2, a)
    v.box(-3, 15, -2, 2, 15, 1, a)
    v.box(-5, 12, -4, 4, 12, 3, a)
    v.box(-4, 12, -3, 3, 12, 2, a)
    v.box(-1, 13, 3, 0, 14, 3, P.orange)
  }
  if (l.hat === 'cap') {
    v.box(-4, 13, -3, 3, 14, 2, a)
    v.box(-3, 15, -2, 2, 15, 1, a)
    v.box(-3, 12, 3, 2, 12, 4, b)
    v.set(-1, 14, 3, P.white)
    v.set(0, 14, 3, P.white)
  }
  if (l.hat === 'straw') {
    v.box(-6, 13, -5, 5, 13, 4, a)
    v.box(-3, 14, -2, 2, 15, 1, a)
    v.box(-3, 14, -2, 2, 14, 1, b)
  }
  if (l.hat === 'band') {
    v.paint(-4, 11, -3, 3, 11, 2, a)
    v.box(-4, 11, -3, 3, 11, -3, a)
    v.set(-1, 11, 2, a)
  }
  if (l.hat === 'goggles') {
    v.paint(-4, 12, -3, 3, 12, 2, a)
    v.box(-3, 12, 3, -2, 12, 3, b)
    v.box(1, 12, 3, 2, 12, 3, b)
  }
  if (l.hat === 'phones') {
    // headphones over the hood (the listener): band `a` arcs over the top,
    // chunky cups `b` over the ears, tops and fronts open to the camera
    v.box(-4, 15, 0, 3, 15, 0, a)
    v.box(-5, 12, 0, -5, 14, 0, a)
    v.box(4, 12, 0, 4, 14, 0, a)
    v.box(-6, 8, -1, -5, 11, 1, b)
    v.box(4, 8, -1, 5, 11, 1, b)
  }
  return v
}

function buildLeg(l: Look, left: boolean) {
  const v = new Vox()
  const x0 = left ? -2 : 0
  v.box(x0, 1, -1, x0 + 1, 2, 0, l.pants)
  if (l.shorts) v.box(x0, 1, -1, x0 + 1, 1, 0, l.skin)
  v.box(x0, 0, -1, x0 + 1, 0, 1, l.shoes)
  return v
}

function buildArm(l: Look, left: boolean) {
  const v = new Vox()
  const x = left ? -4 : 3
  const sleeve = (l.extras ?? []).includes('vest') && l.shirt === P.white ? l.kit! : l.shirt
  v.box(x, 4, -1, x, 6, 0, l.shorts ? l.skin : sleeve)
  if (l.shorts) v.box(x, 6, -1, x, 6, 0, l.shirt)
  v.box(x, 3, -1, x, 3, 0, l.skin)
  return v
}

/** mesh whose geometry is centred on `pivot` (cell space), inside a group placed at the pivot */
function part(v: Vox, pivot: [number, number, number]) {
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(v.geometry(S, { ramp: 'figure', merge: true, origin: [pivot[0] * S, pivot[1] * S, pivot[2] * S] }), voxMaterial())
  g.add(mesh)
  g.position.set(pivot[0] * S, pivot[1] * S, pivot[2] * S)
  return g
}

export interface FolkPose {
  /** walk frame 0..3, or -1 standing */
  walk: number
  /** extra lift (hops, landing bounce) in world units */
  lift: number
  /** arm swings (radians, + = forward) */
  armL: number
  armR: number
  /** raise the right arm overhead (wave) */
  wave: number
  /** facing, radians about y (0 = toward the camera / south) */
  face: number
}

export class Folk {
  root = new THREE.Group()
  lift = new THREE.Group()
  private legL: THREE.Group
  private legR: THREE.Group
  private armL: THREE.Group
  private armR: THREE.Group
  /** head-top height in world units */
  readonly height: number

  constructor(public look: Look) {
    // merged, never culled: figures turn round
    const body = new THREE.Mesh(buildBody(look).geometry(S, { ramp: 'figure', merge: true }), voxMaterial())
    this.legL = part(buildLeg(look, true), [-1, 3, 0])
    this.legR = part(buildLeg(look, false), [1, 3, 0])
    this.armL = part(buildArm(look, true), [-3.5, 7, 0])
    this.armR = part(buildArm(look, false), [3.5, 7, 0])
    this.lift.add(body, this.legL, this.legR, this.armL, this.armR)
    this.root.add(this.lift)
    this.height = (look.hat === 'hardhat' || look.hat === 'cap' || look.hat === 'phones' || look.style === 'bun' ? 16 : 15) * S
  }

  pose(p: FolkPose) {
    const w = p.walk
    const swing = w === 1 ? 0.62 : w === 3 ? -0.62 : 0
    this.legL.rotation.x = swing
    this.legR.rotation.x = -swing
    this.armL.rotation.x = -swing * 0.8 + p.armL
    this.armR.rotation.x = swing * 0.8 + p.armR
    // wave: arm up and out beside the head, flicking between two stepped angles
    // (sprites cheat proportions: the waving arm stretches so the hand clears the big head)
    const waving = p.wave > 0
    this.armR.rotation.z = waving ? (p.wave > 1 ? 2.75 : 2.2) : 0
    if (waving) this.armR.rotation.x = 0
    this.armR.scale.set(1, waving ? 1.9 : 1, 1)
    this.armR.position.y = (waving ? 8.2 : 7) * S
    this.armL.rotation.z = waving ? -0.25 : 0
    // the passing frames of a walk sit a pixel higher
    const bob = w === 0 || w === 2 ? S * 0.9 : 0
    this.lift.position.y = bob + p.lift
    this.root.rotation.y = p.face
  }
}

/* --------------------------------------------------------------- portraits */

/** 20x20 pixel portrait of a look; `open` = mouth open (talking frame) */
export function paintPortrait(ctx: CanvasRenderingContext2D, l: Look, open: boolean) {
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, w, h)
  }
  const ex = new Set(l.extras ?? [])
  ctx.clearRect(0, 0, 20, 20)
  px(0, 0, 20, 20, l.bg)
  // soft backdrop band
  px(0, 13, 20, 7, P.night)
  // long hair falls behind the shoulders
  if (l.style === 'long') px(3, 5, 14, 12, l.hair)
  if (ex.has('cape')) px(2, 14, 16, 6, l.kit!)
  // shoulders
  px(3, 15, 14, 5, l.shirt)
  px(4, 14, 12, 1, l.shirt)
  if (ex.has('vest')) {
    px(3, 15, 4, 5, l.kit!)
    px(13, 15, 4, 5, l.kit!)
  }
  if (ex.has('apron') || ex.has('stripes')) {
    px(6, 16, 8, 4, l.kit!)
    if (ex.has('stripes')) for (let x = 6; x < 14; x += 2) px(x, 16, 1, 4, l.kit2!)
    px(7, 15, 1, 1, l.kit!)
    px(12, 15, 1, 1, l.kit!)
  }
  if (ex.has('hood')) {
    px(4, 13, 12, 2, l.shirt)
    px(8, 16, 1, 3, P.white)
    px(11, 16, 1, 3, P.white)
  }
  if (ex.has('collar')) {
    px(7, 14, 2, 2, P.white)
    px(11, 14, 2, 2, P.white)
  }
  if (ex.has('belt')) px(3, 19, 14, 1, P.brown)
  if (l.shorts) {
    px(3, 15, 2, 5, l.skin)
    px(15, 15, 2, 5, l.skin)
  }
  // neck + head
  px(9, 13, 2, 2, l.skin)
  px(5, 4, 10, 10, l.skin)
  px(6, 13, 8, 1, l.skin)
  // eyes, blush, mouth
  px(7, 8, 1, 2, l.eyes ?? P.void)
  px(12, 8, 1, 2, l.eyes ?? P.void)
  px(6, 11, 1, 1, l.cheeks ?? P.coral)
  px(13, 11, 1, 1, l.cheeks ?? P.coral)
  if (open) {
    px(9, 11, 2, 2, P.void)
    px(9, 12, 2, 1, P.coral)
  } else px(9, 11, 2, 1, P.brown)
  if (ex.has('glasses')) {
    px(6, 7, 3, 1, P.night)
    px(11, 7, 3, 1, P.night)
    px(9, 8, 2, 1, P.night)
  }
  // hair
  const h = l.hair
  px(5, 2, 10, 3, h)
  px(4, 3, 12, 2, h)
  px(4, 5, 2, 3, h)
  px(14, 5, 2, 3, h)
  px(6, 5, 4, 1, h)
  if (l.style === 'hood') {
    const lining = l.lining ?? h
    px(3, 2, 14, 3, h)
    px(4, 1, 12, 1, h)
    px(3, 5, 2, 9, h)
    px(15, 5, 2, 9, h)
    px(5, 5, 10, 1, lining)
    px(5, 6, 1, 7, lining)
    px(14, 6, 1, 7, lining)
  }
  if (l.style === 'spiky') {
    px(8, 0, 2, 2, h)
    px(12, 1, 2, 1, h)
    px(14, 2, 1, 1, h)
  }
  if (l.style === 'bob') {
    px(4, 5, 2, 7, h)
    px(14, 5, 2, 7, h)
  }
  if (l.style === 'long') {
    px(4, 5, 2, 10, h)
    px(14, 5, 2, 10, h)
  }
  if (l.style === 'bun') px(8, 0, 4, 2, h)
  if (l.style === 'pony') px(15, 4, 2, 8, h)
  // hats
  const a = l.hatA ?? P.white
  const b = l.hatB ?? P.night
  if (l.hat === 'hardhat') {
    px(5, 1, 10, 4, a)
    px(6, 0, 8, 1, a)
    px(3, 5, 14, 1, P.orange)
    px(9, 2, 2, 2, P.cream)
  }
  if (l.hat === 'cap') {
    px(5, 1, 10, 4, a)
    px(6, 0, 8, 1, a)
    px(4, 5, 10, 1, b)
    px(9, 2, 2, 2, P.white)
  }
  if (l.hat === 'straw') {
    px(6, 0, 8, 4, a)
    px(6, 3, 8, 1, b)
    px(1, 4, 18, 2, a)
  }
  if (l.hat === 'band') px(4, 5, 12, 1, a)
  if (l.hat === 'goggles') {
    px(4, 5, 12, 1, a)
    px(6, 4, 3, 2, b)
    px(11, 4, 3, 2, b)
  }
  if (l.hat === 'phones') {
    px(4, 1, 12, 1, a)
    px(3, 2, 1, 5, a)
    px(16, 2, 1, 5, a)
    px(2, 7, 3, 4, b)
    px(15, 7, 3, 4, b)
  }
  if (ex.has('book')) {
    px(11, 16, 6, 4, l.kit!)
    px(11, 16, 6, 1, P.cream)
  }
  if (ex.has('tablet')) {
    px(4, 16, 6, 4, P.steel)
    px(5, 17, 4, 2, P.cyan)
  }
}
