import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECTIONS, TESTIMONIALS } from '../../content'
import { P, sprite } from '../../kit/pixel'
import { Village } from './village'
import { Folk, LOOKS, PLAYER_LOOK } from './folk'
import { EL, LEGS, NPC_GAP, SPAWN, STOPS, npcSpot } from './path'
import { Dialogue, heartURL } from './dialogue'
import './voices.css'

/*
 * SIDE QUESTS — client voices as a 16-bit JRPG village.
 *
 * Seen from the classic 3/4 top-down camera, Player 1 (kit/player1.ts: the
 * signal-green hoodie, hood up, headphones on: Hark means listen) drops in at
 * the village gate (an arch with a hanging SIDE QUESTS nameplate), then walks
 * the road. For each testimonial they walk up to a villager (who turns, hops
 * and shows a '!'), and the RPG dialogue window opens with the villager's
 * portrait, name + company, and the quote typing out.
 *
 *   0.00–0.05   in-beat: the iris opens on the gate, the player drops in
 *   0.024–0.112 location banner 'Client voices' / 'We listen. They talk.'
 *   0.095–0.915 eight beats (SPAN ≈ 0.1025): walk (first 30%), then talk
 *   0.915–1.00  out-beat: the player turns to camera and waves, the chest by
 *               the last stop pops open with a heart container, the iris
 *               closes on them
 *
 * Positions, facing, walk frames, the camera, the chest and the bubbles are
 * pure functions of `local` (+ time for idle life; the goodbye wave, the '…'
 * dots and the village's blinkers all settle within a few seconds). Only the
 * dialogue's typewriter is time-driven, and it settles to the exact text in
 * < 0.8 s.
 */

const N = TESTIMONIALS.length
const B0 = 0.095
const B1 = 0.915
const SPAN = (B1 - B0) / N
/** fraction of a beat spent walking */
const WALK = 0.3
/** the villager notices the player at this point of the walk-in */
const NOTICE = 0.17
/** dialogue window open for this part of a beat */
const TALK_A = 0.33
const TALK_B = 0.985
const HEAD_A = 0.024
const HEAD_B = 0.112
const IN_END = 0.05
const OUT_A = 0.918
const HYST = 0.004
/** the reward: lid swings open, then the heart container rises (done before the 0.94 cut) */
const CHEST_A = 0.918
const CHEST_B = 0.926
const PRIZE_A = 0.922
const PRIZE_B = 0.936
/** the goodbye wave (and the '…' bubble) animate this long, then hold still */
const WAVE_T = 3.2
const CHAT_T = 3

const beatStart = (k: number) => B0 + k * SPAN
const anchorAt = (k: number) => B0 + (k + 0.62) * SPAN

/** which way each villager faces while busy (before / after their chat) */
const BUSY_FACE = [Math.PI, 0, Math.PI / 2, Math.PI / 2, Math.PI / 2, 0, Math.PI / 2, Math.PI / 2]
/** busy animation: [arm swing amplitude, fps] */
const BUSY_ANIM: [number, number][] = [
  [1.2, 4],
  [0.5, 2],
  [0.9, 3],
  [0.4, 2],
  [0.7, 3],
  [0.2, 1],
  [1.2, 4],
  [0.35, 6],
]

interface Layout {
  W: number
  H: number
  aspect: number
  narrow: boolean
  fov: number
}

interface Shot {
  f: THREE.Vector3
  vh: number
  sy: number
}
const mkShot = (): Shot => ({ f: new THREE.Vector3(), vh: 10, sy: 0 })
function mixShot(a: Shot, b: Shot, t: number, o: Shot) {
  o.f.lerpVectors(a.f, b.f, t)
  o.vh = lerp(a.vh, b.vh, t)
  o.sy = lerp(a.sy, b.sy, t)
  return o
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let village: Village
  let player: Folk
  const npcs: Folk[] = []
  let shadows: THREE.InstancedMesh
  let bang: THREE.Mesh
  let talk: THREE.Mesh[] = []
  let hearts: THREE.Mesh[] = []
  let dust: THREE.InstancedMesh
  let dlg: Dialogue
  let head: HTMLElement
  let headParts: HTMLElement[] = []
  let outro: HTMLElement
  let probe: HTMLElement
  let stageEl: HTMLElement
  let active = false
  /** when the out-beat wave began (-1 = not in it) */
  let outAt = -1

  // layout measurements (re-read only on resize)
  const ins = { top: 90, bottom: 90, dlg: 220, head: 120 }
  let insDirty = true
  let insW = -1
  let insH = -1

  // scratch
  const p2 = new THREE.Vector2()
  const d2 = new THREE.Vector2()
  const shot = mkShot()
  const sa = mkShot()
  const sb = mkShot()
  const follow = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const camTarget = new THREE.Vector3()
  const proj = new THREE.PerspectiveCamera(22, 1, 0.1, 400)
  const ndc = new THREE.Vector3()
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v3 = new THREE.Vector3()
  const s3 = new THREE.Vector3()
  const up = new THREE.Vector3()
  const right = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  /* ------------------------------------------------------------- layout */

  function layoutOf(f: Frame): Layout {
    const W = f.width
    const H = f.height
    const aspect = W / Math.max(1, H)
    return { W, H, aspect, narrow: aspect < 0.85 || W < 640, fov: 22 }
  }

  function measure(f: Frame) {
    if (!probe) return
    if (f.width !== insW || f.height !== insH) {
      insW = f.width
      insH = f.height
      insDirty = true
    }
    if (!insDirty) return
    insDirty = false
    const h = stageEl.clientHeight || f.height
    ins.top = probe.offsetTop
    ins.bottom = Math.max(0, h - probe.offsetTop - probe.offsetHeight)
    ins.dlg = dlg.height
    ins.head = head.offsetHeight
  }

  /* --------------------------------------------------------------- story */

  /** player xz + facing + walk frame at `local` */
  function playerAt(local: number, out: THREE.Vector2) {
    let face = 0
    let walk = -1
    if (local < B0) {
      out.copy(SPAWN)
      // faces the camera for the title beat, turns north as the walk begins
      face = local < B0 - 0.012 ? 0 : Math.PI
    } else if (local >= B1) {
      out.copy(STOPS[N - 1])
      face = local >= OUT_A ? 0 : Math.PI
    } else {
      const k = Math.min(N - 1, Math.floor((local - B0) / SPAN))
      const u = (local - beatStart(k)) / SPAN
      if (u < WALK) {
        const w = u / WALK
        const e = lerp(w, w * w * (3 - 2 * w), 0.55)
        const leg = LEGS[k]
        const dist = e * leg.total
        leg.at(dist, out, d2)
        face = Math.atan2(d2.x, d2.y)
        walk = Math.floor(dist / 0.3) % 4
      } else {
        out.copy(STOPS[k])
        face = Math.PI
      }
    }
    return { face, walk }
  }

  function talkFocus(k: number, o: THREE.Vector3) {
    const s = STOPS[k]
    // centre a little north of the pair so the villager's set piece is in frame
    return o.set(s.x, 0.72, s.y - NPC_GAP * 0.5 - 0.7)
  }

  function talkShot(k: number, L: Layout, o: Shot) {
    talkFocus(k, o.f)
    const bandTop = ins.top
    const bandBot = L.H - ins.bottom - ins.dlg - 10
    const bandPx = Math.max(120, bandBot - bandTop)
    const minW = L.narrow ? 6.2 : 11
    o.vh = Math.max((5.2 * L.H) / bandPx, minW / L.aspect)
    o.sy = 1 - (2 * ((bandTop + bandBot) / 2)) / L.H
    return o
  }

  function headShot(L: Layout, o: Shot) {
    o.f.set(SPAWN.x, 0.6, SPAWN.y - 2.4)
    const bandTop = ins.top + ins.head + 8
    const bandBot = L.H - ins.bottom
    const bandPx = Math.max(160, bandBot - bandTop)
    const minW = L.narrow ? 7.5 : 12.5
    o.vh = Math.max((6.6 * L.H) / bandPx, minW / L.aspect)
    o.sy = 1 - (2 * ((bandTop + bandBot) / 2)) / L.H
    return o
  }

  function shotAt(local: number, L: Layout, o: Shot) {
    if (local < B0) {
      headShot(L, o)
      o.vh *= 1 - 0.04 * segment(local, IN_END, B0)
      if (local < IN_END) {
        const e = 1 - Math.pow(1 - local / IN_END, 3)
        o.vh *= 1 + 0.45 * (1 - e)
        o.f.z -= 1.5 * (1 - e)
      }
      return o
    }
    if (local >= B1) {
      // push in on the hero as they wave goodbye; the iris closes on them
      talkShot(N - 1, L, sa)
      const t = smoothstep(B1, 0.975, local)
      o.f.copy(sa.f).lerp(v3.set(STOPS[N - 1].x, 0.62, STOPS[N - 1].y - 0.25), t)
      o.vh = sa.vh * (1 - 0.04 * (1 - t)) * lerp(1, L.narrow ? 0.8 : 0.72, t)
      o.sy = lerp(sa.sy, 0.02, t)
      return o
    }
    const k = Math.min(N - 1, Math.floor((local - B0) / SPAN))
    const u = (local - beatStart(k)) / SPAN
    if (u >= WALK) {
      talkShot(k, L, o)
      // slow push-in while the villager talks
      o.vh *= 1 - 0.04 * ((u - WALK) / (1 - WALK))
      return o
    }
    const w = u / WALK
    if (k === 0) {
      headShot(L, sa)
      sa.vh *= 0.96
    } else {
      talkShot(k - 1, L, sa)
      sa.vh *= 0.96
    }
    talkShot(k, L, sb)
    const e = smoothstep(0, 1, w)
    mixShot(sa, sb, e, o)
    // ride along with the player mid-walk so they never leave the frame
    playerAt(local, p2)
    follow.set(p2.x, 0.72, p2.y - 0.3)
    o.f.lerp(follow, 0.6 * Math.sin(Math.PI * w))
    o.vh *= 1 + 0.1 * Math.sin(Math.PI * w)
    return o
  }

  function solve(s: Shot, L: Layout, pos: THREE.Vector3, target: THREE.Vector3) {
    // fixed JRPG camera: looks north, tilted down
    const dir = v3.set(0, Math.sin(EL), Math.cos(EL))
    fwd.copy(dir).negate()
    right.crossVectors(fwd, UP).normalize()
    up.crossVectors(right, fwd)
    const tv = Math.tan(THREE.MathUtils.degToRad(L.fov / 2))
    const d = s.vh / 2 / tv
    target.copy(s.f).addScaledVector(up, -s.sy * d * tv)
    pos.copy(target).addScaledVector(dir, d)
  }

  /** a little camera shake as the player lands (never under reduced motion) */
  function shake(local: number, t: number, calm: boolean, target: THREE.Vector3, pos: THREE.Vector3) {
    if (calm) return
    const a = (1 - segment(local, 0.031, 0.047)) * (local > 0.03 ? 1 : 0) * 0.07
    if (a <= 0) return
    const j = Math.floor(t * 30)
    const dx = (((j * 7919) % 13) / 6.5 - 1) * a
    const dy = (((j * 104729) % 11) / 5.5 - 1) * a
    target.x += dx
    pos.x += dx
    target.y += dy
    pos.y += dy
  }

  /* ----------------------------------------------------------- dialogue */

  function wantLine(local: number) {
    if (local < B0 || local >= B1) {
      const s = dlg.shown
      // hysteresis at the ends of the run
      if (s === N - 1 && local >= B1 && local < B1 + HYST) return s
      return -1
    }
    const k = Math.min(N - 1, Math.floor((local - B0) / SPAN))
    const u = (local - beatStart(k)) / SPAN
    const s = dlg.shown
    const h = HYST / SPAN
    if (u >= TALK_A && u < TALK_B) return k
    if (s === k && u >= TALK_A - h && u < TALK_B + h) return k
    if (s === k - 1 && u < h) return s
    return -1
  }

  /* --------------------------------------------------------------- DOM */

  function buildDom(stage: HTMLElement) {
    stageEl = stage
    probe = el('div', 'vo-probe', undefined, stage)
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => (insDirty = true))
      ro.observe(stage)
    }
    head = el('div', 'vo-head hud-panel', undefined, stage)
    const eb = el('p', 'hud-eyebrow vo-eyebrow', undefined, head)
    headParts.push(rise(el('span', '', undefined, eb), SECTIONS.voices.eyebrow))
    const m = SECTIONS.voices.title.match(/^(.*?\.)\s+(.*)$/)
    const html = m ? `${m[1]} <em>${m[2]}</em>` : SECTIONS.voices.title
    headParts.push(rise(el('h2', 'hud-h2 vo-title', undefined, head), html))

    dlg = new Dialogue(stage, TESTIMONIALS, LOOKS, i => window.__hark?.land('voices', true, anchorAt(i)))
    dlg.root.style.setProperty('--vo-heart-on', `url(${heartURL(P.coral)})`)
    dlg.root.style.setProperty('--vo-heart-now', `url(${heartURL(P.signal)})`)
    dlg.root.style.setProperty('--vo-heart-off', `url(${heartURL(P.night, P.steel)})`)
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => (insDirty = true)).observe(dlg.root)

    outro = el('div', 'vo-outro hud-panel', undefined, stage)
    const hs = el('span', 'vo-outro-hearts', undefined, outro)
    for (let i = 0; i < N; i++) el('i', '', undefined, hs)
    el('span', 'vo-outro-txt', `${N}/${N} voices heard`, outro)
    outro.style.setProperty('--vo-heart-on', `url(${heartURL(P.coral)})`)
  }

  /* ---------------------------------------------------------- sprites */

  function billboard(m: THREE.Object3D, cam: THREE.Camera) {
    m.quaternion.copy(cam.quaternion)
  }

  function buildSprites() {
    bang = sprite(
      ['.kkkkk.', 'kwwwwwk', 'kwwrwwk', 'kwwrwwk', 'kwwrwwk', 'kwwwwwk', 'kwwrwwk', 'kwwwwwk', '.kkkkk.', '..kk...', '..k....'],
      { k: P.void, w: P.white, r: P.coral },
      { pixelSize: 0.085 },
    )
    const talkRows = (n: number) => {
      const dots = ['kwwwwwwwwwk', 'kwwwwwwwwwk', 'kwwwwwwwwwk']
      const row = 'kw' + [0, 1, 2].map(i => (i < n ? 'd' : 'w') + 'w').join('') + 'wwk'
      return ['.kkkkkkkkk.', dots[0], row.slice(0, 11), dots[2], '.kkkkkkkkk.', '..kk.......', '..k........']
    }
    talk = [1, 2, 3].map(n => sprite(talkRows(n), { k: P.void, w: P.white, d: P.void }, { pixelSize: 0.068 }))
    const heartRows = ['.cc.cc.', 'cwccccc', 'ccccccc', '.ccccc.', '..ccc..', '...c...']
    hearts = [0, 1, 2].map(i => sprite(heartRows, { c: i === 1 ? P.magenta : P.coral, w: P.white }, { pixelSize: i === 1 ? 0.05 : 0.065 }))
    for (const m of [bang, ...talk, ...hearts]) {
      const mat = m.material as THREE.MeshBasicMaterial
      mat.depthTest = false
      m.renderOrder = 20
      m.visible = false
      group.add(m)
    }
    // landing dust
    dust = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(P.white), toneMapped: false }), 6)
    dust.frustumCulled = false
    group.add(dust)
    // blob shadows (one instanced draw for everyone)
    const cv = document.createElement('canvas')
    cv.width = 12
    cv.height = 6
    const cx = cv.getContext('2d')!
    cx.fillStyle = '#000'
    for (let y = 0; y < 6; y++) {
      const w = Math.round(12 * Math.sqrt(1 - Math.pow((y - 2.5) / 3, 2)))
      cx.fillRect(Math.round((12 - w) / 2), y, w, 1)
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.magFilter = tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.78, 0.42).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(P.void), transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false }),
      N + 1,
    )
    shadows.frustumCulled = false
    shadows.renderOrder = 1
    group.add(shadows)
  }

  /* ------------------------------------------------------------ update */

  function updateCharacters(local: number, frame: Frame, calm: boolean, cam: THREE.Camera) {
    const t = frame.time
    const k = local < B0 ? -1 : local >= B1 ? N : Math.min(N - 1, Math.floor((local - B0) / SPAN))
    const u = k >= 0 && k < N ? (local - beatStart(k)) / SPAN : 0

    // ---- player
    const { face, walk } = playerAt(local, p2)
    let lift = 0
    if (local < IN_END && !calm) {
      // drop in from above, squash-bounce on landing (stepped)
      const fall = segment(local, 0.0, 0.031)
      lift = (1 - fall * fall) * 3.2
      const b = segment(local, 0.031, IN_END)
      if (fall >= 1) lift = Math.abs(Math.sin(b * Math.PI * 2)) * 0.28 * (1 - b)
      lift = Math.round(lift / 0.05) * 0.05
    } else if (walk < 0 && !calm) lift = (Math.floor(t * 2) % 2) * 0.03
    let wave = 0
    let waving = false
    if (local >= OUT_A + 0.006) {
      if (outAt < 0) outAt = t
      // wave for a few seconds, then hold the hand up (still)
      waving = !calm && t - outAt < WAVE_T
      wave = waving ? 1 + (Math.floor(t * 4) % 2) : 1
      // a happy hop on every other wave
      lift = waving && Math.floor(t * 2) % 2 === 0 && Math.floor(t * 4) % 2 === 1 ? 0.1 : 0
    } else outAt = -1
    player.root.position.set(p2.x, 0, p2.y)
    player.pose({ walk, lift, armL: 0, armR: 0, wave, face })

    // ---- villagers
    let bangOn = false
    let bangScale = 0
    for (let i = 0; i < N; i++) {
      const n = npcs[i]
      const spot = npcSpot(i)
      const s = beatStart(i)
      const noticed = local >= s + NOTICE * SPAN && (i === N - 1 || local < beatStart(i + 1) + WALK * SPAN * 0.45)
      const talking = dlg.typing === i
      const onAir = dlg.shown === i
      let nf = noticed ? 0 : BUSY_FACE[i]
      let nl = 0
      let armR = 0
      let armL = 0
      if (noticed) {
        // hop when they spot you
        const h = segment(local, s + NOTICE * SPAN, s + (NOTICE + 0.08) * SPAN)
        if (h > 0 && h < 1) nl = Math.round(Math.sin(h * Math.PI) * 0.22 / 0.055) * 0.055
        if (onAir && !calm) {
          nl += talking ? (Math.floor(t * 8) % 2) * 0.05 : (Math.floor(t * 2 + i) % 2) * 0.03
          armR = talking ? -0.5 - (Math.floor(t * 6) % 2) * 0.5 : 0
        }
      } else if (!calm) {
        const [amp, fps] = BUSY_ANIM[i]
        const st = Math.floor(t * fps + i * 0.7) % 2
        armR = -amp * st
        armL = i === 7 ? -amp * (1 - st) : 0
        nl = (Math.floor(t * 1.5 + i * 0.37) % 2) * 0.03
      }
      if (local >= B1 && local >= OUT_A + 0.01 && i === N - 1) {
        nf = 0
        armR = 0
      }
      n.root.position.set(spot.x, 0, spot.y)
      n.pose({ walk: -1, lift: nl, armL, armR, wave: local >= OUT_A + 0.01 && i === N - 1 ? (waving ? 2 - (Math.floor(t * 4) % 2) : 1) : 0, face: nf })
      // '!' pops over the villager you're walking up to
      if (i === k && u >= NOTICE && u < 0.44) {
        bangOn = true
        const p = (u - NOTICE) / 0.05
        bangScale = p < 1 ? [0.4, 1.35, 1.1, 1][Math.min(3, Math.floor(p * 4))] : u > 0.41 ? 0.5 : 1
        bang.position.set(spot.x, n.height + 0.55 + nl, spot.y)
      }
    }
    bang.visible = bangOn
    if (bangOn) {
      bang.scale.setScalar(bangScale)
      billboard(bang, cam)
    }

    // '…' over whoever holds the dialogue (3 fps)
    const sp = dlg.shown
    for (let j = 0; j < talk.length; j++) talk[j].visible = false
    if (sp >= 0 && !(k === sp && u < 0.44)) {
      // the dots cycle while the villager is new to the window, then rest at '…'
      const frameIx = calm || t - dlg.openedAt > CHAT_T ? 2 : Math.floor(t * 3) % 3
      const m = talk[frameIx]
      const spot = npcSpot(sp)
      m.visible = true
      m.position.set(spot.x + 0.42, npcs[sp].height + 0.5, spot.y)
      billboard(m, cam)
    }

    // hearts float up from the villager you just talked to
    for (const h of hearts) h.visible = false
    const heartFrom = k >= 1 && k <= N && (k === N ? local - B1 : u * SPAN) < 0.03 ? k - 1 : -1
    if (heartFrom >= 0) {
      const p = (k === N ? local - B1 : u * SPAN) / 0.03
      const st = Math.floor(p * 8) / 8
      const spot = npcSpot(heartFrom)
      hearts.forEach((h, j) => {
        const delay = j * 0.18
        const pp = clamp((st - delay) / (1 - delay))
        if (pp <= 0 || pp >= 1) return
        h.visible = true
        h.position.set(spot.x + (j - 1) * 0.32, npcs[heartFrom].height + 0.2 + pp * 0.9, spot.y)
        h.scale.setScalar(pp < 0.15 ? 0.6 : pp > 0.85 ? 0.7 : 1)
        billboard(h, cam)
      })
    }

    // landing dust puffs
    const dp = segment(local, 0.031, 0.05)
    for (let i = 0; i < dust.count; i++) {
      const a = (i / dust.count) * Math.PI * 2
      const r = 0.3 + dp * 0.55
      const s = dp > 0 && dp < 1 && !calm ? Math.round((1 - dp) * 4) / 4 : 0
      v3.set(SPAWN.x + Math.cos(a) * r, 0.08 + dp * 0.2, SPAWN.y + Math.sin(a) * r * 0.6)
      m4.compose(v3, q.identity(), s3.set(s, s, s))
      dust.setMatrixAt(i, m4)
    }
    dust.instanceMatrix.needsUpdate = true

    // shadows
    q.identity()
    const all = [player, ...npcs]
    for (let i = 0; i < all.length; i++) {
      const f = all[i]
      const l = f.lift.position.y
      const s = i === 0 ? clamp(1 - l * 0.25, 0.35, 1) : 1
      v3.set(f.root.position.x, 0.085, f.root.position.z)
      m4.compose(v3, q, s3.set(s, 1, s))
      shadows.setMatrixAt(i, m4)
    }
    shadows.instanceMatrix.needsUpdate = true
  }

  return {
    id: 'voices',
    group,
    anchors: TESTIMONIALS.map((_, i) => anchorAt(i)),

    async init(ctx: ChapterContext) {
      village = new Village(ctx.mobile)
      await village.build()
      group.add(village.group)
      await nextFrame()
      player = new Folk(PLAYER_LOOK)
      group.add(player.root)
      LOOKS.forEach(look => {
        const n = new Folk(look)
        npcs.push(n)
        group.add(n.root)
      })
      buildSprites()
      buildDom(ctx.stage)
    },

    onEnter() {
      active = true
      insDirty = true
    },

    onLeave() {
      active = false
      outAt = -1
      dlg.reset()
      for (const p of headParts) setRise(p, false)
      head.classList.remove('is-on')
      outro.classList.remove('is-on')
    },

    update(local, frame, ctx) {
      const calm = ctx.reducedMotion
      const now = frame.time
      const L = layoutOf(frame)
      measure(frame)

      // the camera the engine will use this frame (for billboards + iris)
      shotAt(local, L, shot)
      solve(shot, L, camPos, camTarget)
      shake(local, now, calm, camTarget, camPos)
      proj.fov = L.fov
      proj.aspect = L.aspect
      proj.position.copy(camPos)
      proj.up.set(0, 1, 0)
      proj.lookAt(camTarget)
      proj.updateProjectionMatrix()
      proj.updateMatrixWorld()

      // dialogue first (villagers read its typing state)
      dlg.update(active ? wantLine(local) : -1, now, calm)
      const k = local < B0 ? 0 : local >= B1 ? N : Math.min(N - 1, Math.floor((local - B0) / SPAN))
      dlg.setProgress(k)

      updateCharacters(local, frame, calm, proj)
      village.update(now, calm, proj, k)
      village.setChest(segment(local, CHEST_A, CHEST_B), segment(local, PRIZE_A, PRIZE_B), calm, proj)

      // header banner + outro toast
      const headOn = local > HEAD_A && local < HEAD_B
      if (head.classList.contains('is-on') !== headOn) head.classList.toggle('is-on', headOn)
      for (const p of headParts) setRise(p, headOn)
      const outOn = local > OUT_A + 0.012 && local < 0.985
      if (outro.classList.contains('is-on') !== outOn) outro.classList.toggle('is-on', outOn)

      // iris centred on the player (the classic level-end circle)
      if (active) {
        ndc.set(player.root.position.x, 0.62, player.root.position.z).project(proj)
        if (Number.isFinite(ndc.x + ndc.y)) {
          ctx.post.params.irisX = clamp(ndc.x * 0.5 + 0.5, 0.2, 0.8)
          ctx.post.params.irisY = clamp(ndc.y * 0.5 + 0.5, 0.2, 0.8)
        }
      }

      // world + lens: bright daylight, no stars, crisp fine pixels
      const w = ctx.world.params
      w.top = P.pine
      w.bottom = P.pine
      w.stars = 0
      const p = ctx.post.params
      p.pixel = frame.width < 600 ? 3 : 4
      p.bloomThreshold = 1.0
      p.bloomStrength = 0.4
      p.bloomRadius = 0.35
      p.vignette = 0.28
      p.dither = 0.4
    },

    camera(local, frame, out) {
      const L = layoutOf(frame)
      shotAt(local, L, shot)
      solve(shot, L, out.position, out.target)
      shake(local, frame.time, frame.reducedMotion, out.target, out.position)
      out.fov = L.fov
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.22
    },
  }
}
