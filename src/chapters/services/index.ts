import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { P } from '../../kit/pixel'
import { Hud, type HudState } from './hud'
import { BURST, SPARKS, buildLevel, driftClouds, type Level } from './scene'
import {
  ANCHORS,
  BEAT,
  BLOCK_SIZE,
  BLOCK_Y,
  FIN_RUN_END,
  GOAL_X,
  HERO_VOXEL,
  INTRO_END,
  ITEM_Y,
  N,
  POWER_AT,
  RUN,
  START_X,
  SVC_END,
  blockX,
} from './layout'
import './services.css'

/*
 * POWER-UPS — services as a platformer level (3.8 viewport heights).
 * See layout.ts for the run sheet.
 *
 * Scroll is the d-pad: the player runs exactly as far as you scroll, from
 * one ?-block to the next. Arriving under a block BONKS it: the block is
 * used, a power-up (one voxel icon per service) hovers above it spinning,
 * and the item card names it. When the bonk happens live (you scrolled into
 * it) the game plays it out in real time: jump, squash, coin burst, a tiny
 * shake and hit-flash, the item popping out with overshoot. Jumping straight
 * to any point (nav, screenshots) shows the settled state. At the end all
 * eleven items fly to orbit the player: POWER UP!
 */

/** seconds, relative to the bonk's live start */
const T_HIT = 0.14
const T_LAND = 0.44
const T_ITEM0 = 0.16
const T_ITEM1 = 0.52
const COIN_LIFE = 0.72
const HERO_H = 19 * HERO_VOXEL
const JUMP_H = BLOCK_Y - BLOCK_SIZE / 2 - HERO_H
const FOV = 30
const PITCH = 0.075
/** the WordPress card holds until POWER UP! takes over: no blank beat between */
const CARD_OFF = POWER_AT
/**
 * run progress (fraction of a beat) at which the last item has slid out of
 * view (behind the card on wide layouts, off the left edge on tall ones): the
 * card stops naming it and turns to NEXT ▶ ? BLOCK 0k until the bonk
 */
const NEXT_AT = 0.6 * RUN
/** how high the player floats at the power-up */
const LIFT = 1.25
/*
 * Every blink here is finite and ends lit (WCAG 2.2.2): the ?-glyph shimmer
 * rests on white once the scroll has been still this long; the twinkles round
 * a new item and round the powered-up player settle on after a few blinks.
 */
const SHIMMER_FOR = 4
const TWINKLE_FOR = 2.5
const POWER_TWINKLE_FOR = 3.5
/** hit-flashes at most one per this many seconds (WCAG 2.3.1) */
const FLASH_GAP = 0.5

const stepT = (t: number, fps: number) => Math.floor(t * fps) / fps
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const runEase = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t))
const GRAV = 13
/** burst coins fan out left and right of the block, clear of the rising item */
const coinVel = (i: number, k: number): [number, number] => {
  const side = i % 2 ? 1 : -1
  const a = (0.17 + 0.1 * (i >> 1) + hash(i + k * 7) * 0.05) * Math.PI
  const sp = 6.2 + hash(i * 3.1 + k) * 1.2
  return [side * Math.cos(a) * sp, Math.sin(a) * sp]
}

interface Rect {
  x0: number
  x1: number
  y0: number
  y1: number
}
interface Region {
  l: number
  r: number
  b: number
  t: number
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let level: Level | null = null
  let hud: Hud | null = null
  let calm = false
  let mobile = false

  // live flourishes (never needed for the settled look, which derives from local)
  let lastLocal = -1
  let lastBonked = -1
  let bonkK = -1
  let bonkT0 = -99
  let pokeK = -1
  let pokeT0 = -99
  let lastFlash = -99
  let bonkFlash = false
  let powerT0 = -99
  let powerFlash = false
  let wasPower = false
  // when the scroll last moved, the featured item changed, POWER UP! began
  let movedT = -99
  let featured = -2
  let featuredT0 = -99
  let powerOnT = -99
  // cosmetic sprite state: is the player moving, and which way is he facing
  let prevX = START_X
  let speed = 0
  let facing = 1

  const pose = { position: new THREE.Vector3(0, 3, 24), target: new THREE.Vector3(0, 3, 0), fov: FOV, parallax: 0 }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const pv = new THREE.Vector3()
  const sv = new THREE.Vector3()
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
  const proj = new THREE.Vector3()
  const projCam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500)
  const ray = new THREE.Raycaster()
  const rect: Rect = { x0: 0, x1: 0, y0: 0, y1: 0 }
  const rectB: Rect = { x0: 0, x1: 0, y0: 0, y1: 0 }
  const reg: Region = { l: -1, r: 1, b: -1, t: 1 }
  const regB: Region = { l: -1, r: 1, b: -1, t: 1 }
  const hs: HudState = { ready: false, intro: false, shown: -1, next: -1, got: 0, power: false }

  const jumpTo = (k: number) => {
    const eng = window.__hark?.engine
    if (eng) eng.gotoChapter('services', ANCHORS[k], true)
    else window.__hark?.gotoChapter('services', ANCHORS[k])
  }

  /** screen-px region → NDC */
  function region(out: Region, frame: Frame, kind: 'intro' | 'card' | 'full' | 'safe') {
    const m = hud!.metrics()
    const W = Math.max(1, frame.width)
    const H = Math.max(1, frame.height)
    const nx = (px: number) => (2 * px) / W - 1
    const ny = (py: number) => 1 - (2 * py) / H
    const box = kind === 'intro' ? m.intro : m.card
    out.t = ny(m.safeTop - 6)
    out.b = ny(H - m.safeBottom + 30)
    out.l = nx(m.gutter)
    out.r = nx(W - m.gutter)
    if (kind === 'safe') return
    if (kind === 'full') {
      // leave the top of the safe area for the POWER UP! title (and never
      // less than the banner itself: short landscape has little to spare)
      out.t = ny(Math.max(m.safeTop + Math.min(170, H * 0.2), m.powerBottom + 10))
      return
    }
    if (m.tall) out.b = ny(Math.max(m.safeTop + 140, box.top - 8))
    else out.l = nx(box.right + clamp(W * 0.03, 16, 48))
  }

  const lerpRect = (a: Rect, b: Rect, t: number) => {
    a.x0 = lerp(a.x0, b.x0, t)
    a.x1 = lerp(a.x1, b.x1, t)
    a.y0 = lerp(a.y0, b.y0, t)
    a.y1 = lerp(a.y1, b.y1, t)
  }
  const lerpReg = (a: Region, b: Region, t: number) => {
    a.l = lerp(a.l, b.l, t)
    a.r = lerp(a.r, b.r, t)
    a.b = lerp(a.b, b.b, t)
    a.t = lerp(a.t, b.t, t)
  }
  const beatRect = (out: Rect, x: number, tall: boolean) => {
    // the player a little left of centre so the next ?-block peeks in;
    // on phones the scene band is short, so frame it tighter
    out.x0 = x - (tall ? 3.4 : 4.6)
    out.x1 = x + (tall ? 3.4 : 6.6)
    out.y0 = tall ? -0.45 : -1.1
    out.y1 = ITEM_Y + (tall ? 1.35 : 2.4)
  }
  const introRect = (out: Rect, tall: boolean) => {
    out.x0 = tall ? -3.4 : -4.6
    out.x1 = blockX(0) + (tall ? 1.6 : 3.2)
    out.y0 = tall ? -0.45 : -1.1
    out.y1 = ITEM_Y + (tall ? 1.35 : 2.4)
  }

  /** fit the world rect into the NDC region; bottom-aligned (or centred) when there's room */
  function solve(frame: Frame, centre = 0) {
    const aspect = frame.width / Math.max(1, frame.height)
    const th = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const rw = Math.max(0.1, reg.r - reg.l)
    const rh = Math.max(0.1, reg.t - reg.b)
    const halfH = Math.max((rect.y1 - rect.y0) / rh, (rect.x1 - rect.x0) / (rw * aspect))
    const halfW = halfH * aspect
    const cx = (rect.x0 + rect.x1) / 2 - ((reg.l + reg.r) / 2) * halfW
    const cy = lerp(rect.y0 - reg.b * halfH, (rect.y0 + rect.y1) / 2 - ((reg.b + reg.t) / 2) * halfH, centre)
    const D = halfH / th
    pose.target.set(cx, cy, 0)
    pose.position.set(cx, cy + D * Math.sin(PITCH), D * Math.cos(PITCH))
    pose.fov = FOV
    pose.parallax = calm ? 0 : Math.min(0.5, D * 0.012)
  }

  function setItem(mesh: THREE.Mesh, x: number, y: number, z: number, s: number, rotY: number) {
    mesh.position.set(x, y, z)
    mesh.rotation.set(0, rotY, 0)
    mesh.scale.setScalar(s)
    mesh.visible = s > 0.01
  }

  return {
    id: 'services',
    group,
    anchors: ANCHORS,

    async init(ctx: ChapterContext) {
      calm = ctx.reducedMotion
      mobile = ctx.mobile
      level = buildLevel(ctx.mobile)
      group.add(level.root)
      await nextFrame()
      hud = new Hud(ctx.stage, jumpTo, calm)
    },

    onEnter() {
      lastLocal = -1
      bonkK = -1
      pokeK = -1
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      if (!level || !hud) return
      const L = level
      const time = frame.time
      const t = calm ? 0 : time
      const m = hud.metrics()
      const tall = m.tall

      /* ---------------- where are we? ---------------- */
      const u = (local - INTRO_END) / BEAT
      const bonked = clamp(Math.floor(u - RUN) + 1, 0, N)
      const k = clamp(Math.floor(u), 0, N - 1)
      const p = u - k
      const fin = clamp((local - SVC_END) / (FIN_RUN_END - SVC_END))
      const power = local >= POWER_AT

      // live crossings → flourishes
      const live = lastLocal >= 0 && Math.abs(local - lastLocal) < BEAT * 2.5
      if (local !== lastLocal) movedT = time
      if (bonked > lastBonked && lastBonked >= 0 && live && bonked > 0) {
        bonkK = bonked - 1
        bonkT0 = time
        // hit-flash at most ~2 a second, however fast the scroll
        bonkFlash = time - lastFlash > FLASH_GAP
        if (bonkFlash) lastFlash = time
      } else if (!live || (bonked < lastBonked && bonkK >= bonked)) bonkK = -1
      if (power && !wasPower && live) {
        powerT0 = time
        powerFlash = time - lastFlash > FLASH_GAP
        if (powerFlash) lastFlash = time
      }
      if (power !== wasPower) powerOnT = time
      wasPower = power
      lastBonked = bonked
      lastLocal = local
      const tb = bonkK >= 0 ? time - bonkT0 : 99

      /* ---------------- the player ---------------- */
      let hx: number
      if (local < INTRO_END) hx = START_X
      else if (local < SVC_END) {
        const from = k === 0 ? START_X : blockX(k - 1)
        hx = p < RUN ? lerp(from, blockX(k), runEase(p / RUN)) : blockX(k)
      } else hx = lerp(blockX(N - 1), GOAL_X, runEase(fin))
      const dx = hx - prevX
      prevX = hx
      if (Math.abs(dx) > 1.5) speed = 0 // a jump, not a run
      else {
        if (Math.abs(dx) > 1e-4) facing = dx > 0 ? 1 : -1
        speed = lerp(speed, Math.abs(dx) / Math.max(frame.dt, 1e-3), 1 - Math.exp(-14 * frame.dt))
      }
      if (local < INTRO_END || (local >= INTRO_END && local < SVC_END && p >= RUN && bonkK !== k)) facing = 1

      let hy = 0
      let frameKey: keyof Level['heroFrames'] = 'idle'
      let squash = 1
      const jumping = bonkK >= 0 && tb < T_LAND && bonkK === bonked - 1
      if (jumping) {
        frameKey = 'jump'
        hy = tb < T_HIT ? JUMP_H * ease.outQuad(tb / T_HIT) : JUMP_H * (1 - ease.inQuad((tb - T_HIT) / (T_LAND - T_HIT)))
        facing = 1
      } else if (speed > 0.6) {
        // legs cycle at a fixed sprite rate, like a real run animation
        frameKey = Math.floor(time * 11) % 2 === 0 ? 'runA' : 'runB'
      } else if (power) frameKey = 'cheer'
      // POWER UP: he rises into the middle of his ring of items and hovers
      const lift = local >= SVC_END ? LIFT * ease.outBack(clamp((local - (POWER_AT - 0.006)) / 0.014)) : 0
      if (lift > 0) {
        hy = lift + (calm ? 0 : Math.round(Math.sin(stepT(time, 8) * 3)) * 0.05)
        if (lift > 0.3) frameKey = 'cheer'
      }
      if (bonkK >= 0 && tb >= T_LAND && tb < T_LAND + 0.09) squash = 0.86
      if (!jumping && frameKey === 'idle' && !calm) squash *= Math.floor(time * 2) % 2 ? 0.975 : 1
      L.hero.geometry = L.heroFrames[frameKey]
      L.hero.position.set(hx, hy, 0)
      L.hero.scale.set(facing * (2 - squash), squash, 1)
      // drop shadow shrinks as he leaves the ground
      const sh = 1 - clamp(hy / JUMP_H) * 0.55
      L.shadow.position.set(hx, 0.012, 0.05)
      L.shadow.scale.setScalar(sh)

      /* ---------------- blocks ---------------- */
      const shimmer = calm || time - movedT > SHIMMER_FOR ? 0 : Math.floor(time * 5) % 4
      for (let j = 0; j < N; j++) {
        const b = L.blocks[j]
        const used = j < bonked
        b.material = used ? L.usedMat : L.qMats[shimmer]
        let off = 0
        let sx = 1
        let sy = 1
        const bt = j === bonkK ? tb - T_HIT : j === pokeK ? time - pokeT0 : -1
        if (bt >= 0 && bt < 0.24) {
          const s = stepT(bt, 30) / 0.24
          off = Math.sin(Math.PI * s) * 0.32
          sy = 1 - 0.18 * Math.sin(Math.PI * Math.min(1, s * 2))
          sx = 2 - sy
        }
        b.position.set(blockX(j), BLOCK_Y + off, 0)
        b.scale.set(sx, sy, 1)
      }

      /* ---------------- power-ups ---------------- */
      // the featured item (bigger, haloed) is the last one collected; it keeps
      // that look until it leaves, even once the card has moved on to NEXT
      const shown = local < CARD_OFF ? bonked - 1 : -1
      if (shown !== featured) {
        featured = shown
        featuredT0 = time
      }
      const ts = stepT(t, 12)
      const orbitSpin = calm ? 0 : t * 0.9
      const shrink = 1 - 0.28 * smoothstep(0.955, 1, local)
      // phones get a rounder, tighter halo so it fills the narrow frame
      const RX = (tall ? 2.25 : 3.3) * shrink
      const RY = (tall ? 2.0 : 1.85) * shrink
      const ringY = HERO_H * 0.5 + (tall ? 0.25 : 0.1) + lift
      for (let j = 0; j < N; j++) {
        const it = L.items[j]
        // idle spin: a quick full turn now and then, otherwise facing us with a sway
        const T = 3.4
        const ph = (((ts + j * 0.61) % T) + T) % T / T
        const rotY = calm ? 0 : ph < 0.22 ? ease.inOutCubic(ph / 0.22) * Math.PI * 2 : Math.sin(((ph - 0.22) / 0.78) * Math.PI * 2) * 0.3
        const bob = calm ? 0 : Math.round(Math.sin(ts * 3 + j) * 2) * 0.035
        if (j >= bonked) {
          it.visible = false
          continue
        }
        const base = j === shown ? 1.28 : 0.9
        if (local >= SVC_END) {
          // fly in to orbit the player
          const e0 = clamp((fin - j * 0.04) / 0.6)
          const ef = ease.inOutCubic(e0)
          const a = orbitSpin + (j / N) * Math.PI * 2
          // a halo of items circling him, facing us
          const ox = hx + Math.cos(a) * RX
          const oy = ringY + Math.sin(a) * RY
          const oz = 0.7
          const x = lerp(blockX(j), ox, ef)
          const y = lerp(ITEM_Y + bob, oy, ef) + Math.sin(Math.PI * ef) * 2.4
          const z = lerp(0, oz, ef)
          setItem(it, x, y, z, lerp(base, tall ? 0.54 : 0.62, ef), ef > 0.9 ? rotY * 0.3 : rotY)
          continue
        }
        if (j === bonkK && tb < T_ITEM1) {
          const f = clamp((tb - T_ITEM0) / (T_ITEM1 - T_ITEM0))
          const y = lerp(BLOCK_Y, ITEM_Y, ease.outBack(f))
          setItem(it, blockX(j), y, 0, f <= 0 ? 0 : lerp(0.45, base, ease.outCubic(f)), rotY)
          continue
        }
        setItem(it, blockX(j), ITEM_Y + bob, 0, base, rotY)
      }

      // aura: behind the current item, then behind the player at the finale
      if (local >= SVC_END) {
        const a = smoothstep(POWER_AT - 0.012, POWER_AT, local)
        L.aura.visible = a > 0.02
        L.aura.position.set(hx, hy + HERO_H * 0.5, -0.5)
        L.aura.scale.setScalar(ease.outBack(a) * 0.95)
      } else if (shown >= 0) {
        const pop = shown === bonkK ? clamp((tb - T_ITEM0) / 0.3) : 1
        L.aura.visible = pop > 0.02
        L.aura.position.set(blockX(shown), ITEM_Y, -0.45)
        L.aura.scale.setScalar(ease.outBack(pop) * 0.9)
      } else L.aura.visible = false
      L.aura.rotation.z = calm ? 0 : -stepT(t, 5) * (Math.PI / 8)

      /* ---------------- coins ---------------- */
      const rows = L.coinRow.length
      const coinSpin = (i: number) => (calm ? 0 : Math.floor(t * 8 + i * 0.7) * (Math.PI / 4))
      for (let i = 0; i < rows; i++) {
        const c = L.coinRow[i]
        const got = hx > c.x - 0.3 && local >= INTRO_END
        if (got) L.coins.setMatrixAt(i, hidden)
        else {
          e.set(0, coinSpin(i), 0)
          L.coins.setMatrixAt(i, m4.compose(pv.set(c.x, c.y + (calm ? 0 : Math.round(Math.sin(ts * 4 + i)) * 0.03), 0), q.setFromEuler(e), sv.setScalar(1)))
        }
      }
      for (let i = 0; i < BURST; i++) {
        const src = bonkK >= 0 && tb >= T_HIT && tb < T_HIT + COIN_LIFE ? bonkK : pokeK >= 0 && time - pokeT0 < COIN_LIFE ? pokeK : -1
        const ct = src === bonkK && bonkK >= 0 ? tb - T_HIT : time - pokeT0
        if (src < 0 || calm) {
          L.coins.setMatrixAt(rows + i, hidden)
          continue
        }
        const [vx, vy] = coinVel(i, src)
        const x = blockX(src) + vx * ct
        const y = BLOCK_Y + BLOCK_SIZE / 2 + vy * ct - GRAV * ct * ct
        e.set(0, coinSpin(i + 3), 0)
        const s = ct > COIN_LIFE - 0.1 ? 0 : 1
        L.coins.setMatrixAt(rows + i, m4.compose(pv.set(x, y, 0.4 + i * 0.05), q.setFromEuler(e), sv.setScalar(s)))
      }
      L.coins.instanceMatrix.needsUpdate = true

      /* ---------------- sparkles ---------------- */
      let si = 0
      const spark = (x: number, y: number, z: number, s: number) => {
        if (si >= SPARKS) return
        if (s <= 0.01) L.sparkles.setMatrixAt(si++, hidden)
        else L.sparkles.setMatrixAt(si++, m4.compose(pv.set(x, y, z), q.identity(), sv.setScalar(s)))
      }
      // twinkles round the current item
      if (shown >= 0 && local < SVC_END && !calm) {
        for (let i = 0; i < 4; i++) {
          const a = stepT(t, 8) * 1.6 + (i / 4) * Math.PI * 2
          const blink = time - featuredT0 < TWINKLE_FOR && Math.floor(t * 6 + i * 1.5) % 3 === 0 ? 0 : 1
          spark(blockX(shown) + Math.cos(a) * 1.05, ITEM_Y + Math.sin(a) * 0.95, 0.3, blink * (i % 2 ? 0.7 : 1))
        }
      }
      // coins collected on the run
      for (let i = 0; i < rows && si < 10; i++) {
        const d = hx - (L.coinRow[i].x - 0.3)
        if (d > 0 && d < 0.9 && local >= INTRO_END) spark(L.coinRow[i].x, L.coinRow[i].y + d * 0.6, 0.3, Math.ceil((1 - d / 0.9) * 3) / 3)
      }
      // burst coins vanish in a twinkle
      if (bonkK >= 0 && !calm) {
        for (let i = 0; i < BURST; i++) {
          const ct = tb - T_HIT
          const end = COIN_LIFE - 0.1
          if (ct > end && ct < COIN_LIFE + 0.12) {
            const [vx, vy] = coinVel(i, bonkK)
            spark(blockX(bonkK) + vx * end, BLOCK_Y + BLOCK_SIZE / 2 + vy * end - GRAV * end * end, 0.5, 0.9)
          }
        }
      }
      // finale: sparkles spiral round the powered-up player
      if (power && !calm) {
        for (let i = 0; i < 4; i++) {
          const a = -stepT(t, 10) * 2.2 + (i / 4) * Math.PI * 2 + 0.4
          const rr = 1.5
          const blink = time - powerOnT < POWER_TWINKLE_FOR && Math.floor(t * 4 + i) % 3 === 0 ? 0 : 1
          spark(hx + Math.cos(a) * rr, hy + HERO_H * 0.5 + Math.sin(a) * rr, 0.8, blink * 0.75)
        }
      }
      while (si < SPARKS) L.sparkles.setMatrixAt(si++, hidden)
      L.sparkles.instanceMatrix.needsUpdate = true

      driftClouds(L, t)

      /* ---------------- camera ---------------- */
      let centre = 0
      if (local < INTRO_END + RUN * BEAT) {
        // the start line: centred for the iris (READY?), then framed beside
        // the intro window, then follow the run to block 01
        const r0 = smoothstep(0.028, 0.06, local)
        // READY?: the player dead centre, where the iris opens
        rect.x0 = START_X - 4.4
        rect.x1 = START_X + 4.4
        rect.y0 = tall ? -0.45 : -1.1
        rect.y1 = ITEM_Y + (tall ? 1.35 : 2.4)
        introRect(rectB, tall)
        lerpRect(rect, rectB, r0)
        region(reg, frame, 'safe')
        region(regB, frame, 'intro')
        lerpReg(reg, regB, r0)
        centre = 1 - r0
        const f = runEase(clamp((local - INTRO_END + 0.012) / (RUN * BEAT + 0.012)))
        beatRect(rectB, hx, tall)
        lerpRect(rect, rectB, f)
        region(regB, frame, 'card')
        lerpReg(reg, regB, f)
      } else if (local < SVC_END) {
        beatRect(rect, hx, tall)
        region(reg, frame, 'card')
      } else {
        beatRect(rect, hx, tall)
        region(reg, frame, 'card')
        rectB.x0 = hx - (tall ? 3.0 : 4.6)
        rectB.x1 = hx + (tall ? 3.0 : 4.6)
        rectB.y0 = tall ? -0.6 : -1.0
        rectB.y1 = tall ? 5.1 : 4.6
        region(regB, frame, 'full')
        const f = ease.inOutCubic(fin)
        lerpRect(rect, rectB, f)
        // tall layouts park the scene above the card, so the scene may only
        // spread into the card's room once the card has gone, and must do so
        // at once (a slow blend leaves the bottom half of the screen as dirt):
        // a quick push-in on the POWER UP! beat, ~12 px of scroll on a phone
        lerpReg(reg, regB, tall ? smoothstep(CARD_OFF, CARD_OFF + 0.004, local) : f)
        centre = f
        // as the iris closes, bring the powered-up player to screen centre
        const c = smoothstep(0.948, 0.985, local)
        if (c > 0) {
          rectB.x0 = hx - RX - (tall ? 0.8 : 1.4)
          rectB.x1 = hx + RX + (tall ? 0.8 : 1.4)
          rectB.y0 = ringY - RY - 1.1
          rectB.y1 = ringY + RY + 1.1
          regB.l = -0.8
          regB.r = 0.8
          regB.b = -0.72
          regB.t = 0.72
          lerpRect(rect, rectB, c)
          lerpReg(reg, regB, c)
        }
      }
      solve(frame, centre)

      // screen shake on the bonk (and the power-up)
      if (!calm) {
        const st = bonkK >= 0 ? tb - T_HIT : 99
        const pt = time - powerT0
        let amp = 0
        if (st >= 0 && st < 0.22) amp = 0.11 * (1 - st / 0.22)
        if (pt >= 0 && pt < 0.35) amp = Math.max(amp, 0.16 * (1 - pt / 0.35))
        if (amp > 0) {
          const n = Math.floor(time * 30)
          const sx = (hash(n) - 0.5) * 2 * amp
          const sy = (hash(n + 17) - 0.5) * 2 * amp
          pose.position.x += sx
          pose.position.y += sy
          pose.target.x += sx
          pose.target.y += sy
        }
      }

      /* ---------------- world & CRT ---------------- */
      const wp = ctx.world.params
      wp.top = P.blue
      wp.bottom = P.cyan
      wp.stars = 0
      const pp = ctx.post.params
      pp.pixel = mobile ? 3 : 4
      // a bright daytime level: bloom would lift the dark outlines into mush,
      // so only pure white gets a whisper of phosphor
      pp.bloomThreshold = 0.98
      pp.bloomStrength = 0.12
      pp.bloomRadius = 0.3
      pp.vignette = 0.28
      if (!calm) {
        // hit-flash: a quick white pop, never more than ~2 a second
        const ft = bonkK >= 0 && bonkFlash ? tb - T_HIT : 99
        if (ft >= 0 && ft < 0.08) pp.flash = 0.16 * (1 - ft / 0.08)
        const pt = powerFlash ? time - powerT0 : 99
        if (pt >= 0 && pt < 0.14) pp.flash = Math.max(pp.flash, 0.3 * (1 - pt / 0.14))
      }

      /* ---------------- HUD ---------------- */
      // the card: the item just collected, then NEXT ▶ once it is out of view
      // (and between the intro window and the first bonk)
      const running = local >= INTRO_END + 0.02 && local < SVC_END && p < RUN
      const next = running && (k === 0 || p >= NEXT_AT) ? k : -1
      hs.ready = local < 0.034
      hs.intro = local >= 0.034 && local < INTRO_END + 0.02
      hs.shown = next >= 0 ? -1 : shown
      hs.next = next
      hs.got = local >= CARD_OFF ? N : bonked
      hs.power = power
      hud.update(hs, time)
      if (local < 0.05) {
        // READY? floats over the player
        proj.set(hx, HERO_H + 0.9, 0)
        projCam.fov = pose.fov
        projCam.aspect = frame.width / Math.max(1, frame.height)
        projCam.position.copy(pose.position)
        projCam.lookAt(pose.target)
        projCam.updateProjectionMatrix()
        projCam.updateMatrixWorld()
        proj.project(projCam)
        hud.placeReady(((proj.x + 1) / 2) * frame.width, ((1 - proj.y) / 2) * frame.height)
      }
    },

    onPointerDown(frame: Frame, ctx: ChapterContext) {
      if (!level) return
      ray.setFromCamera(frame.pointerRaw, ctx.camera)
      const hits = ray.intersectObjects(level.blocks, false)
      const hit = hits[0]
      if (!hit) return
      const j = level.blocks.indexOf(hit.object as THREE.Mesh)
      if (j >= 0 && j !== bonkK) {
        // poke a block: it bumps and coughs up a few more coins
        pokeK = j
        pokeT0 = frame.time
      }
    },

    camera(_local: number, _frame: Frame, out: CameraPose) {
      out.position.copy(pose.position)
      out.target.copy(pose.target)
      out.fov = pose.fov
      out.roll = 0
      out.parallax = pose.parallax
    },
  }
}
