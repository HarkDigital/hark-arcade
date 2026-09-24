import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { Builder } from './builder'
import { buildIsland, makeWater } from './map'
import { buildNodes, buildStatic, type NodeParts } from './nodes'
import { Player } from './player'
import { Boat, Bursts, Clouds, Coins, PathDots } from './fx'
import { MapHud, type Band, type Layout } from './hud'
import * as T from './timeline'
import './process.css'

/*
 * WORLD MAP — the process chapter as a 16-bit overworld (see timeline.ts for
 * the beat sheet). The island is one faceted mesh; the player walks the
 * dotted path node to node; each node flips to CLEAR!; a RESULTS screen
 * tallies the stats; the iris closes on the player.
 */

const DEG = Math.PI / 180
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _v = new THREE.Vector3()
const _pt = { x: 0, z: 0, dx: 0, dz: 0 }

const lerpBand = (a: Band, b: Band, t: number, out: Band) => {
  out.l = lerp(a.l, b.l, t)
  out.r = lerp(a.r, b.r, t)
  out.t = lerp(a.t, b.t, t)
  out.b = lerp(a.b, b.b, t)
  return out
}

/** Frame the shot's subject (w × h world units) inside the free band (px). */
function applyShot(s: T.Shot, W: number, H: number, band: Band, pos: THREE.Vector3, target: THREE.Vector3) {
  const aspect = W / Math.max(1, H)
  const tv = Math.tan((s.fov * DEG) / 2)
  const th = tv * aspect
  const wn = Math.max(0.2, ((band.r - band.l) / W) * 2)
  const hn = Math.max(0.2, ((band.b - band.t) / H) * 2)
  const dist = Math.max(s.w / (th * wn), s.h / (tv * hn))
  const sx = (band.l + band.r) / W - 1
  const sy = 1 - (band.t + band.b) / H
  const el = s.el * DEG
  _dir.set(0, Math.sin(el), Math.cos(el))
  _right.set(1, 0, 0)
  _up.crossVectors(_dir, _right)
  target
    .set(s.x, s.y, s.z)
    .addScaledVector(_right, -sx * dist * th)
    .addScaledVector(_up, -sy * dist * tv)
  pos.copy(target).addScaledVector(_dir, dist)
  return dist
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let hud: MapHud | null = null
  let layout: Layout | null = null
  let nodes: NodeParts | null = null
  let player: Player | null = null
  let dots: PathDots | null = null
  let coins: Coins | null = null
  let stars: Bursts | null = null
  let works: Bursts | null = null
  let clouds: Clouds | null = null
  let boat: Boat | null = null
  let water: ReturnType<typeof makeWater> | null = null
  let measuredW = 0
  let measuredH = 0
  let measure: (() => void) | null = null

  // camera, computed in update() so the HUD can project with the exact pose
  const camPos = new THREE.Vector3(0, 20, 20)
  const camTarget = new THREE.Vector3()
  let camFov = 24
  const shot: T.Shot = { ...T.OVERVIEW }
  const sA: T.Shot = { ...T.OVERVIEW }
  const sB: T.Shot = { ...T.OVERVIEW }
  const band: Band = { l: 0, r: 1, t: 0, b: 1 }
  const bA: Band = { l: 0, r: 1, t: 0, b: 1 }
  const screen: Band = { l: 0, r: 1, t: 0, b: 1 }
  const proj = new THREE.PerspectiveCamera(24, 1, 0.1, 3000)

  // short "juice" events (stars, shake, flash) fired on forward crossings
  let prevLocal = -1
  let shakeT0 = -99
  let shakeAmp = 0
  let flashT0 = -99
  let fireN = -1
  const tagPts: ({ x: number; y: number } | null)[] = [null, null, null, null, null]
  const tagState: ('' | 'cur' | 'clear')[] = ['', '', '', '', '']
  const tagWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const burstAt = new THREE.Vector3()

  /** the follow shot: the player's smoothed path position, buildings in view */
  function followShot(s: number, W: number, out: T.Shot, fb: Band) {
    let x = 0
    let z = 0
    for (const o of [-1.4, 0, 1.4]) {
      T.pathAt(s + o, _pt)
      x += _pt.x
      z += _pt.z
    }
    x /= 3
    z /= 3
    const bw = Math.max(120, fb.r - fb.l)
    const w = clamp(bw / 66, 6.4, 13.5)
    out.x = x
    out.y = T.groundAt(x, z) * 0.6 + 0.5
    out.z = z - 1.3
    out.w = w
    out.h = w * 0.62
    out.el = 52
    out.fov = 24
    void W
    return out
  }

  return {
    id: 'process',
    group,
    anchors: T.ANCHORS,

    async init(ctx: ChapterContext) {
      hud = new MapHud(ctx.stage)
      const h = hud
      measure = () => {
        const W = ctx.stage.clientWidth || window.innerWidth
        const H = ctx.stage.clientHeight || window.innerHeight
        layout = h.layout(W, H)
        measuredW = W
        measuredH = H
      }
      measure()
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => measure?.())
        ro.observe(ctx.stage)
        ro.observe(h.head)
        ro.observe(h.card)
      }
      await nextFrame()

      // the island + buildings: one faceted mesh (+ one outline hull)
      const b = new Builder()
      buildIsland(b, ctx.mobile)
      await nextFrame()
      const hooks = buildStatic(b)
      group.add(b.mesh())
      await nextFrame()

      water = makeWater()
      group.add(water.group)
      await nextFrame()

      nodes = buildNodes(hooks, ctx.mobile)
      group.add(nodes.group)
      player = new Player()
      group.add(player.root)
      dots = new PathDots()
      group.add(dots.mesh)
      coins = new Coins()
      group.add(coins.mesh)
      stars = new Bursts(4, ctx.mobile ? 12 : 16, 0.2, 1.6)
      group.add(stars.mesh)
      works = new Bursts(3, ctx.mobile ? 12 : 16, 0.17, 1.3)
      group.add(works.mesh)
      clouds = new Clouds(ctx.mobile)
      group.add(clouds.group)
      boat = new Boat(T.wx(7.35), T.SEA_Y - 0.12, T.wz(17.95))
      group.add(boat.mesh)
      for (let i = 0; i < 4; i++) tagWorld[i + 1].copy(nodes.pads[i]).add(_v.set(0, 0, 0.62))
      tagWorld[0].copy(nodes.start).add(_v.set(0, 0, 0.62))
      // fonts for the in-world labels + measure once the web fonts are in
      void document.fonts?.ready.then(() => measure?.())
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      const l = clamp(local)
      const calm = frame.reducedMotion
      const time = frame.time
      const W = Math.max(1, frame.width)
      const H = Math.max(1, frame.height)
      if (measure && (Math.abs(measuredW - W) > 1 || Math.abs(measuredH - H) > 1)) measure()
      const L = layout

      // ---- look: fine 16-bit pixels, clean palette (colours are already exact)
      const p = ctx.post.params
      p.pixel = frame.mobile ? 2.5 : 3
      p.dither = 0.3
      p.bloomThreshold = 1.02
      p.bloomStrength = 0.7
      p.bloomRadius = 0.45
      p.vignette = 0.3
      p.crt = 0.5
      const w = ctx.world.params
      w.top = '#1b1f3b'
      w.bottom = '#3a7bff'
      w.stars = 0

      // ---- player along the path
      const ps = T.playerS(l)
      T.pathAt(ps.s, _pt)
      const px = _pt.x
      const pz = _pt.z
      const py = T.groundAt(px, pz)

      // ---- events: forward crossings only, never on jumps
      const dl = l - prevLocal
      const scrolling = prevLocal >= 0 && dl > 0 && dl < 0.06
      if (nodes && stars) {
        for (let i = 0; i < 4; i++) {
          const c = T.CLEAR[i]
          if (scrolling && prevLocal < c && l >= c) {
            burstAt.copy(nodes.pads[i]).add(_v.set(0, 0.7, 0))
            if (!calm) {
              stars.fire(i, burstAt, time)
              shakeT0 = time
              shakeAmp = i === 2 ? 0.16 : 0.09
              flashT0 = time
            }
          }
          if (l < c) stars.clear(i)
        }
      }
      prevLocal = l

      // ---- camera shot (pure function of l, + stepped shake)
      if (L) {
        screen.l = 0
        screen.r = W
        screen.t = 0
        screen.b = H
        const START = nodes?.start ?? new THREE.Vector3()
        const startShot: T.Shot = { x: START.x, y: 0.95, z: START.z, w: 4.6, h: 3.4, el: 60, fov: 24 }
        const n4 = nodes?.pads[3] ?? new THREE.Vector3()
        const endShot: T.Shot = { x: n4.x, y: n4.y + 1.1, z: n4.z, w: 3.6, h: 2.8, el: 62, fov: 24 }
        const over = sA
        Object.assign(over, T.OVERVIEW)
        if (L.portrait) {
          over.w = 26
          over.x = 0.3
        }
        const resShot: T.Shot = { ...over, w: over.w * 1.02, el: 58 }
        const follow = followShot(ps.s, W, sB, L.follow)
        const [f0, f1] = T.CAM.follow
        const [r0, r1] = T.CAM.results
        if (l < T.CAM.startOut[1]) {
          const k = smoothstep(T.CAM.startOut[0], T.CAM.startOut[1], l)
          T.mixShot(startShot, over, k, shot)
          lerpBand(screen, L.overview, k * k, band)
        } else if (l < f0) {
          Object.assign(shot, over)
          Object.assign(band, L.overview)
        } else if (l < f1) {
          const k = smoothstep(f0, f1, l)
          T.mixShot(over, follow, k, shot)
          lerpBand(L.overview, L.follow, k, band)
        } else if (l < r0) {
          Object.assign(shot, follow)
          Object.assign(band, L.follow)
        } else if (l < r1) {
          const k = smoothstep(r0, r1, l)
          T.mixShot(follow, resShot, k, shot)
          lerpBand(L.follow, L.full, k, bA)
          Object.assign(band, bA)
        } else if (l < T.CAM.end[0]) {
          Object.assign(shot, resShot)
          Object.assign(band, L.full)
        } else {
          const k = clamp((l - T.CAM.end[0]) / (T.CAM.end[1] - T.CAM.end[0]))
          const e = k * k * (3 - 2 * k)
          T.mixShot(resShot, endShot, e, shot)
          lerpBand(L.full, screen, 1 - (1 - e) * (1 - e), band)
        }
        const dist = applyShot(shot, W, H, band, camPos, camTarget)
        camFov = shot.fov
        // stepped screen shake (30 fps jitter, decays in 0.3 s)
        const sa = time - shakeT0
        if (!calm && sa >= 0 && sa < 0.3) {
          const q = Math.floor(sa * 30)
          const amp = shakeAmp * (1 - sa / 0.3) * (dist / 20)
          const jx = (((q * 7919) % 13) / 6.5 - 1) * amp
          const jy = (((q * 104729) % 11) / 5.5 - 1) * amp
          camPos.x += jx
          camTarget.x += jx
          camPos.y += jy
          camTarget.y += jy
        }
      }

      // ---- post juice
      const fa = time - flashT0
      if (!calm && fa >= 0 && fa < 0.12) p.flash = 0.28 * (1 - fa / 0.12)

      // ---- world
      water?.tick(time)
      boat?.update(time, calm)
      const dive = smoothstep(T.CAM.follow[0] - 0.02, T.CAM.follow[1], l) * (1 - smoothstep(T.CAM.results[0], T.CAM.results[1], l))
      clouds?.update(time, calm, 1 + dive * 1.3)
      nodes?.update(l, time, calm, ctx.camera)
      dots?.update(ps.s)
      coins?.update(ps.s, time, calm)
      stars?.update(time, 0.85)

      // fireworks over the results screen / world clear
      if (works) {
        if (!calm && l >= T.RESULTS[0] - 0.01 && l < 0.94) {
          const period = 0.62
          const n = Math.floor(time / period)
          if (n !== fireN) {
            fireN = n
            const h1 = Math.sin(n * 12.9898) * 43758.5453
            const h2 = Math.sin(n * 78.233) * 12345.678
            const rx = h1 - Math.floor(h1)
            const rz = h2 - Math.floor(h2)
            const endK = smoothstep(0.93, 0.98, l)
            const cx = lerp(-10 + rx * 20, (nodes?.pads[3].x ?? 0) + (rx - 0.5) * 3, endK)
            const cz = lerp(-6 + rz * 10, (nodes?.pads[3].z ?? 0) - 1 + (rz - 0.5) * 2, endK)
            burstAt.set(cx, lerp(3.2 + rx * 1.5, 2.2, endK), cz)
            works.fire(n % 3, burstAt, n * period, 1.2, 0.3)
          }
        } else if (l < T.RESULTS[0] - 0.01) {
          for (let i = 0; i < 3; i++) works.clear(i)
          fireN = -1
        }
        works.update(time, 1.15)
      }

      // ---- player
      if (player) {
        player.root.position.set(px, py, pz)
        let yaw = 0
        if (ps.walking) yaw = Math.atan2(_pt.dx, _pt.dz)
        let hop = 0
        for (let i = 0; i < 4; i++) {
          const k = (l - T.CLEAR[i]) / 0.014
          if (k > 0 && k < 1) hop = Math.max(hop, Math.sin(k * Math.PI) * 0.8)
        }
        const party = l >= T.RESULTS[0]
        if (party && !calm) {
          const t12 = Math.floor(time * 12) / 12
          hop = Math.abs(Math.sin(t12 * Math.PI * 1.5))
        }
        player.pose({
          dist: ps.s,
          walking: ps.walking,
          yaw,
          time,
          calm,
          hop,
          cheer: party || hop > 0.2,
          marker: l > 0.015 && l < T.CARD_OUT,
        })
      }

      // ---- HUD
      if (hud && L) {
        const card = T.cardAt(l)
        let mask = 0
        for (let i = 0; i < 4; i++) if (T.cleared(l, i)) mask |= 1 << i
        hud.setCard(card, mask)
        const headOn = l >= T.HEAD[0] && l < T.HEAD[1] && !(L.compact && card >= 0)
        hud.setHead(headOn)
        hud.setResults(l >= T.RESULTS[0] && l < T.RESULTS[1], time, calm)

        // tags under the nodes: exact projection with this frame's camera
        const tagsOn = l >= 0.075 && l < T.CARD_OUT - 0.005
        if (tagsOn) {
          proj.fov = camFov
          proj.aspect = W / H
          proj.updateProjectionMatrix()
          proj.position.copy(camPos)
          proj.up.set(0, 1, 0)
          proj.lookAt(camTarget)
          if (!calm) {
            proj.updateMatrixWorld()
            _right.setFromMatrixColumn(proj.matrixWorld, 0)
            _up.setFromMatrixColumn(proj.matrixWorld, 1)
            proj.position.addScaledVector(_right, frame.pointer.x * 0.25).addScaledVector(_up, frame.pointer.y * 0.25 * 0.6)
            proj.lookAt(camTarget)
          }
          proj.updateMatrixWorld()
          const hr = headOn ? L.headRect : null
          const cr = card >= 0 ? L.cardRect : null
          for (let i = 0; i < 5; i++) {
            _v.copy(tagWorld[i]).project(proj)
            const x = (_v.x * 0.5 + 0.5) * W
            const y = (-_v.y * 0.5 + 0.5) * H + 4
            const inBand = x > band.l - 30 && x < band.r + 30 && x > 8 && x < W - 8 && y > band.t - 10 && y < band.b + 10 && _v.z < 1
            // keep the tag on screen (its node still is)
            const tx = clamp(x, 60, W - 60)
            const hit = (r: Layout['headRect'] | null) => !!r && tx + 70 > r.left && tx - 70 < r.right && y + 30 > r.top && y - 4 < r.bottom
            tagPts[i] = Number.isFinite(x) && Number.isFinite(y) && inBand && !hit(hr) && !hit(cr) ? { x: tx, y } : null
            tagState[i] = i === 0 ? '' : T.cleared(l, i - 1) ? 'clear' : card === i - 1 ? 'cur' : ''
          }
        } else for (let i = 0; i < 5; i++) tagPts[i] = null
        hud.setTags(tagPts, tagState)
      }
    },

    camera(_local: number, frame: Frame, out: CameraPose) {
      out.position.copy(camPos)
      out.target.copy(camTarget)
      out.fov = camFov
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.25
    },

    onEnter() {
      prevLocal = -1
    },
  }
}
