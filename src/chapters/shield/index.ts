import * as THREE from 'three'
import type { CameraPose, Chapter } from '../../core/types'
import { Callout } from '../../core/dom'
import { ease, lerp, segment, window01 } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { P } from '../../kit/pixel'
import { BODY_Y, Boss } from './boss'
import { SHIELD_R, Shield, Site } from './site'
import { Backdrop, Floor } from './arena'
import { Bullets, Coins, Debris, Pixels, Pops, Shots } from './fx'
import { Hud } from './hud'
import { T, bossHP, fract, hash1, siteDamage, siteHP, stepq } from './timeline'
import './shield.css'

/*
 * BOSS FIGHT — "Hacked? Breathe."
 *
 * A 16-bit boss battle: a glitchy voxel malware bug looms over a little Hark
 * website and pelts it with bullet fans; the Hark shield blooms into a
 * honeycomb dome, the site fires back, the boss blows up into voxels and
 * coins, YOU WIN, 24/7. Beat sheet in ./timeline.ts.
 */

const FOV = 26
const PITCH = 0.1
/** real-time length of the explosion playback (s) */
const BOOM_DUR = 3.2
/** when (s into the boom) the boss bursts */
const BURST = 0.55
const SHIELD_Z = 0.45
const SITE_CY = 0.78

const SKY = {
  attack: { top: new THREE.Color(P.void), bottom: new THREE.Color(P.purple) },
  shield: { top: new THREE.Color(P.void), bottom: new THREE.Color(P.indigo) },
  win: { top: new THREE.Color(P.indigo), bottom: new THREE.Color(P.coral) },
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let hud: Hud
  let boss: Boss
  let site: Site
  let shield: Shield
  let floor: Floor
  let back: Backdrop
  let px: Pixels
  let bullets: Bullets
  let shots: Shots
  let pops: Pops
  let debris: Debris
  let coins: Coins
  let shieldTag: Callout
  let weakTag: Callout
  let ready = false

  const lay = { siteX: -2.45, bossX: 2.2 }
  const fit = { w: 0, h: 0, d: 16, sx: 0, sy: 0, portrait: false, aim: new THREE.Vector3(0, 1.9, 0) }
  const scratch = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400)
  const pose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: FOV, roll: 0, parallax: 0 }

  // transient punches (decay in real time; the story state never depends on them)
  const env = { shake: 0, flash: 0, glitch: 0, siteHit: 0, bossHit: 0, lastFlash: -9 }
  let prev = -1
  let boomAt: number | null = null
  let prevBt = -1
  let fresh = true
  let struckPrev = 0

  const _a = new THREE.Vector3()
  const _b = new THREE.Vector3()
  const _mouth = new THREE.Vector3()
  const _core = new THREE.Vector3()
  const _siteC = new THREE.Vector3()
  const _center = new THREE.Vector3()
  const _top = new THREE.Color()
  const _bottom = new THREE.Color()
  const _band = new THREE.Color()
  const shieldCircle = { x: 0, y: 0, r: SHIELD_R }

  function place() {
    site.group.position.set(lay.siteX, 0, 0)
    shield.group.position.set(lay.siteX, 0, SHIELD_Z)
    boss.group.position.set(lay.bossX, 0, 0)
    coins.layout(lay.siteX + 1.35, lay.bossX + 2.5)
    shieldCircle.x = lay.siteX
  }

  function measure(w: number, h: number) {
    fit.w = w
    fit.h = h
    fit.portrait = w / Math.max(1, h) < 0.84
    hud.root.classList.toggle('is-portrait', fit.portrait)
    lay.siteX = -2.45
    lay.bossX = 2.2
    place()

    const pr = hud.probe.getBoundingClientRect()
    const hp = hud.hp.getBoundingClientRect()
    const col = hud.col.getBoundingClientRect()
    const gutter = pr.left
    let x0: number, x1: number, y0: number, y1: number
    if (fit.portrait) {
      x0 = gutter * 0.4
      x1 = w - gutter * 0.4
      y0 = hp.bottom + 14
      y1 = Math.max(y0 + h * 0.18, col.top - 10)
    } else {
      x0 = col.right + Math.max(20, w * 0.03)
      x1 = w - gutter * 0.7
      y0 = hp.bottom + 18
      y1 = pr.bottom + (h - pr.bottom) * 0.35
    }
    hud.setArena((x0 + x1) / 2, y0, x1 - x0, y1 - y0)

    // project the arena's key points from a reference pose, then scale + pan
    const d0 = 20
    const left = lay.siteX - SHIELD_R - 0.1
    const right = lay.bossX + 2.95
    fit.aim.set((left + right) / 2, 1.9, 0)
    scratch.aspect = w / Math.max(1, h)
    scratch.fov = FOV
    scratch.updateProjectionMatrix()
    scratch.position.set(fit.aim.x, fit.aim.y + Math.sin(PITCH) * d0, Math.cos(PITCH) * d0)
    scratch.lookAt(fit.aim)
    scratch.updateMatrixWorld(true)
    const pts: [number, number, number][] = [
      [left, 0, SHIELD_Z],
      [left, SHIELD_R, SHIELD_Z],
      [lay.siteX, SHIELD_R + 0.1, SHIELD_Z],
      [right, 0, 1.15],
      [lay.bossX + 2.3, BODY_Y + 1.3, 0],
      [lay.bossX, BODY_Y + 1.62, 0],
      [lay.bossX - 1.4, BODY_Y + 1.45, 0],
      [lay.siteX, -0.05, 1.2],
    ]
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const [x, y, z] of pts) {
      _a.set(x, y, z).project(scratch)
      minX = Math.min(minX, _a.x)
      maxX = Math.max(maxX, _a.x)
      minY = Math.min(minY, _a.y)
      maxY = Math.max(maxY, _a.y)
    }
    const rx0 = (x0 / w) * 2 - 1
    const rx1 = (x1 / w) * 2 - 1
    const ry0 = 1 - (y1 / h) * 2
    const ry1 = 1 - (y0 / h) * 2
    const k = Math.max((maxX - minX) / Math.max(0.05, rx1 - rx0), (maxY - minY) / Math.max(0.05, ry1 - ry0))
    fit.d = d0 * k
    fit.sx = (rx0 + rx1) / 2 - (minX + maxX) / 2 / k
    // portrait: sit the arena on the dialogue box (sky and moon fill the top)
    fit.sy = fit.portrait ? ry0 + 0.02 - minY / k : (ry0 + ry1) / 2 - (minY + maxY) / 2 / k
  }

  function computePose(local: number, time: number, out: CameraPose, still: boolean) {
    const inB = 1 - ease.outCubic(segment(local, 0, 0.12))
    const outB = ease.inCubic(segment(local, T.out[0], 1))
    const el = PITCH + inB * 0.08 + outB * 0.05
    const dist = fit.d * (1 + inB * 0.2) * (1 - outB * 0.3)
    const drift = still ? 0 : Math.sin(time * 0.25) * 0.04
    out.target.copy(fit.aim)
    out.target.y += inB * 0.9
    out.target.x = lerp(out.target.x, lay.siteX, outB * 0.55) + drift
    out.target.y = lerp(out.target.y, SITE_CY, outB * 0.6)
    const cy = Math.cos(el)
    const sy = Math.sin(el)
    out.position.set(out.target.x, out.target.y + sy * dist, out.target.z + cy * dist)
    // pan so the arena sits in its screen region
    const hh = dist * Math.tan((FOV * Math.PI) / 360)
    const hw = hh * (fit.w / Math.max(1, fit.h))
    const px = -fit.sx * hw * (1 - outB * 0.6)
    const py = -fit.sy * hh * (1 - outB * 0.6)
    // camera up = (0, cos, -sin)
    out.target.x += px
    out.position.x += px
    out.target.y += py * cy
    out.position.y += py * cy
    out.target.z -= py * sy
    out.position.z -= py * sy
    // screen shake: stepped (30 fps) jolts, like a real console
    if (!still && env.shake > 0.01) {
      const q = Math.floor(time * 30)
      const ox = (hash1(q) - 0.5) * env.shake * 0.34
      const oy = (hash1(q + 17.3) - 0.5) * env.shake * 0.26
      out.position.x += ox
      out.target.x += ox
      out.position.y += oy
      out.target.y += oy
    }
    out.fov = FOV
    out.roll = 0
    out.parallax = still ? 0 : fit.portrait ? 0.18 : 0.4
  }

  function punch(time: number, shake: number, flash: number, glitch: number) {
    env.shake = Math.max(env.shake, shake)
    // never more than ~2.5 flashes per second, however fast you scroll
    if (flash > 0 && time - env.lastFlash > 0.4) {
      env.flash = Math.max(env.flash, flash)
      env.lastFlash = time
    }
    env.glitch = Math.max(env.glitch, glitch)
  }

  return {
    id: 'shield',
    group,

    async init(ctx) {
      hud = new Hud(ctx.stage)
      back = new Backdrop(ctx.mobile)
      floor = new Floor()
      group.add(back.group, floor.mesh, floor.bed)
      await nextFrame()
      boss = new Boss()
      group.add(boss.group)
      await nextFrame()
      site = new Site()
      shield = new Shield()
      px = new Pixels(ctx.mobile ? 380 : 620)
      bullets = new Bullets(ctx.mobile)
      shots = new Shots(ctx.mobile)
      pops = new Pops()
      debris = new Debris(boss.samples, ctx.mobile)
      coins = new Coins(ctx.mobile)
      group.add(site.group, shield.group, px.mesh, bullets.mesh, shots.mesh, debris.mesh, coins.mesh, ...pops.meshes)
      place()

      shieldTag = new Callout(hud.root, { side: 'left', offset: { x: 56, y: -46 } })
      shieldTag.root.classList.add('bf-callout')
      shieldTag.label.textContent = 'Shield up!'
      weakTag = new Callout(hud.root, { side: 'right', offset: { x: 64, y: -52 } })
      weakTag.root.classList.add('bf-callout', 'bf-callout--weak')
      weakTag.label.textContent = 'Weak point'

      const relayout = () => {
        if (fit.w > 0) measure(fit.w, fit.h)
      }
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(hud.col)
      document.fonts?.ready.then(relayout).catch(() => {})
      ready = true
    },

    onEnter() {
      prev = -1
      boomAt = null
      prevBt = -1
      fresh = true
    },

    update(local, frame, ctx) {
      if (!ready) return
      if (frame.width !== fit.w || frame.height !== fit.h) measure(frame.width, frame.height)
      const rm = ctx.reducedMotion
      const pace = rm ? 0 : 1
      const time = frame.time
      // idle loops run slower and calmer under reduced motion
      const t = rm ? time * 0.35 : time
      const dt = frame.dt

      // ------------------------------------------------------------ events
      const fwd = prev >= 0 && local > prev && local - prev < 0.05
      if (fwd && !rm) {
        if (prev < T.thud && local >= T.thud) punch(time, 0.9, 0, 0.12)
        for (const h of T.siteHits) {
          if (prev < h && local >= h) {
            punch(time, 0.75, 0.3, 0.32)
            env.siteHit = 1
          }
        }
        if (prev < T.shield[0] && local >= T.shield[0]) punch(time, 0.4, 0.32, 0)
        for (const h of T.bossHits) {
          if (prev < h && local >= h) {
            punch(time, 0.4, 0, 0.18)
            env.bossHit = 1
          }
        }
      }
      if (fwd && rm) {
        for (const h of T.siteHits) if (prev < h && local >= h) env.siteHit = 0.5
        for (const h of T.bossHits) if (prev < h && local >= h) env.bossHit = 0.5
      }
      // the explosion plays in real time once triggered (seeded by the scroll
      // position when you jump in, so any local resolves to a settled state)
      if (local >= T.boom) {
        if (boomAt === null) {
          boomAt = time - (fwd ? 0 : segment(local, T.boom, T.boom + 0.06) * BOOM_DUR)
          prevBt = fwd ? -1e-3 : time - boomAt
        }
      } else boomAt = null
      const bt = boomAt === null ? -1 : time - boomAt
      if (bt >= 0 && !rm) {
        if (prevBt < 0 && bt >= 0) punch(time, 0.5, 0.18, 0.4)
        if (prevBt < BURST && bt >= BURST) punch(time, 1.1, 0.5, 0.25)
      }
      prevBt = bt
      prev = local
      const decay = (v: number, k: number) => v * Math.exp(-k * dt)
      env.shake = decay(env.shake, 8)
      env.flash = decay(env.flash, 16)
      env.glitch = decay(env.glitch, 9)
      env.siteHit = decay(env.siteHit, 5)
      env.bossHit = decay(env.bossHit, 7)

      // ------------------------------------------------------------ phases
      const sHP = siteHP(local)
      const bHP = bossHP(local)
      const calm = segment(local, T.shield[0], T.shield[1])
      const dawn = segment(local, T.boom + 0.01, T.refill[1])
      const build = segment(local, T.shield[0], T.shield[1])
      const alive = bt < BURST

      // ------------------------------------------------------------ world + post
      const wp = ctx.world.params
      _top.copy(SKY.attack.top).lerp(SKY.shield.top, calm).lerp(SKY.win.top, dawn)
      _bottom.copy(SKY.attack.bottom).lerp(SKY.shield.bottom, calm).lerp(SKY.win.bottom, dawn)
      wp.top = _top
      wp.bottom = _bottom
      wp.stars = lerp(0.85, 0.35, dawn)
      wp.key = 1.9
      wp.fill = 0.95
      wp.keyDir.set(-0.45, 0.85, 0.7)
      const pp = ctx.post.params
      pp.pixel = frame.mobile ? 3 : 4
      pp.bloomStrength = 0.62
      pp.flash = rm ? 0 : Math.min(0.55, env.flash)
      pp.glitch = rm ? 0 : Math.min(0.45, env.glitch * 0.55)

      // ------------------------------------------------------------ boss
      const du = segment(local, T.drop[0], T.drop[1])
      const land = segment(local, T.drop[1], T.drop[1] + 0.035)
      const drop = du < 1 ? 7.5 * (1 - du * du) : Math.sin(land * Math.PI) * 0.35 * (1 - land)
      const burstGlitch = pace > 0 && alive && local > T.fire[0] && hash1(Math.floor(t * 3)) > 0.78 ? 0.35 : 0
      _siteC.set(lay.siteX, SITE_CY, 0)
      boss.update({
        time: t,
        pace: rm ? 0.3 : 1,
        drop,
        hit: rm ? 0 : bt >= 0 ? Math.max(0, 1 - bt / 0.4) : env.bossHit,
        glitch: rm ? 0 : Math.min(0.9, burstGlitch + 0.1 * (1 - bHP) + env.glitch * 0.6 + (bt >= 0 ? 0.5 : 0)),
        recoil: env.bossHit + struckPrev * 0.15,
        look: _siteC,
        dying: bt >= 0 && alive ? Math.min(1, bt / 0.2) : 0,
        core: struckPrev,
        visible: alive,
      })
      boss.mouthWorld(_mouth)
      boss.coreWorld(_core)
      _center.set(lay.bossX, BODY_Y, 0)

      // ------------------------------------------------------------ fx
      px.begin()
      const fire = window01(local, T.fire[0], T.fire[1], 0.03) * (1 - 0.5 * segment(local, T.counter[0], T.fire[1]))
      const jiggle = bullets.update({
        time: t,
        pace,
        presence: alive ? fire : 0,
        src: _mouth,
        target: _siteC,
        shield: build > 0.5 ? shieldCircle : null,
        siteR: 0.9,
        px,
        heat: { cells: shield.cells, ox: lay.siteX, out: shield.heat },
      })
      const struck = shots.update(
        t,
        alive ? window01(local, T.counter[0], T.counter[1], 0.02) : 0,
        _a.set(lay.siteX + 0.1, 1.5, 0.7),
        _core,
        px,
      )
      struckPrev = struck

      // landing dust
      const dust = segment(local, T.thud, T.thud + 0.05)
      if (dust > 0 && dust < 1) {
        const e = stepq(dust, 8)
        for (let i = 0; i < boss.feet.length; i++) {
          const f = boss.feet[i]
          for (const s of [-1, 1]) {
            px.push(lay.bossX + f.x + s * e * 0.7, 0.12 + e * 0.35, f.z + 0.3, 0.16 * (1 - e), i % 2 ? P.steel : P.cream, 1)
          }
        }
      }

      // explosion pops, debris, coins
      pops.begin()
      if (bt >= 0 && bt < BURST + 0.5) {
        for (let i = 0; i < 11; i++) {
          const s = boss.samples[Math.floor(hash1(i * 5.31 + 2) * boss.samples.length)]
          const ti = 0.03 + i * 0.05
          pops.add(_center.x + s.p.x * 0.9, _center.y + s.p.y * 0.9, 1.1, 0.8 + hash1(i * 2.2) * 0.6, bt - ti)
        }
        pops.add(_center.x, _center.y, 1.3, 3.2, bt - BURST, 11)
        pops.add(_center.x - 0.9, _center.y + 0.6, 1.2, 1.6, bt - BURST - 0.08, 12)
        pops.add(_center.x + 1.0, _center.y - 0.3, 1.2, 1.8, bt - BURST - 0.14, 12)
      }
      pops.end()
      debris.update(bt >= 0 ? bt - BURST : -1, _center)
      coins.update(bt >= 0 ? bt - BURST : -1, t, pace, _center)

      // +HP sparkles while the site refills
      const heal = window01(local, T.refill[0], T.refill[1] + 0.03, 0.02)
      if (heal > 0) {
        for (let k = 0; k < 10; k++) {
          const u = fract(t * 0.7 + k / 10)
          if (hash1(k * 3.3) > heal) continue
          const x = lay.siteX + (hash1(k * 7.1) - 0.5) * 1.7
          const y = 0.35 + u * 1.9
          const a = 0.045 * (u < 0.8 ? 1 : 1 - (u - 0.8) * 5)
          const c = k % 2 ? P.signal : P.cream
          px.push(x, y, 0.9, a, c, 1.4)
          px.push(x - a, y, 0.9, a, c, 1.4)
          px.push(x + a, y, 0.9, a, c, 1.4)
          px.push(x, y - a, 0.9, a, c, 1.4)
          px.push(x, y + a, 0.9, a, c, 1.4)
        }
      }

      // victory fireworks
      if (!rm && local > T.win + 0.01 && local < 0.995) {
        const cols = [P.gold, P.cyan, P.signal, P.coral]
        const n = frame.mobile ? 2 : 3
        for (let s = 0; s < n; s++) {
          const cyc = t / 2.6 + s / n
          const ph = fract(cyc)
          const id = Math.floor(cyc) * 3 + s
          const bx = lerp(lay.siteX - 1.5, lay.bossX + 3.5, hash1(id * 3.1))
          const by = 4.0 + hash1(id * 5.3) * 1.8
          const bz = -3.5
          const col = cols[Math.floor(hash1(id * 7.7) * 4) % 4]
          if (ph < 0.22) {
            const y = lerp(0.8, by, stepq(ph / 0.22, 10))
            px.push(bx, y, bz, 0.1, P.cream, 1.4)
            px.push(bx, y - 0.16, bz, 0.07, P.gold, 1.2)
          } else if (ph < 0.8) {
            const e = (ph - 0.22) / 0.58
            const es = stepq(ease.outCubic(e), 10)
            for (let k = 0; k < 14; k++) {
              const a = (k / 14) * Math.PI * 2 + id
              const r = es * 1.4
              px.push(bx + Math.cos(a) * r, by + Math.sin(a) * r - e * e * 0.7, bz, 0.13 * (1 - e * 0.55), k % 3 ? col : P.white, 1.5)
            }
          }
        }
      }

      // ------------------------------------------------------------ shield
      // the dome retracts once the boss is down; a slow watch ping keeps going
      const retract = 1 - segment(local, T.boom + 0.02, T.card)
      const ping = local > T.card && local < 0.99 ? fract(t / 2.6) : -1
      shield.update(build * retract, segment(local, T.shield[0], T.shield[0] + 0.045), ping, t, pace)

      // ------------------------------------------------------------ site
      let hop = 0
      if (!rm && local > T.refill[1]) {
        const ph = fract(t / 1.7)
        hop = ph < 0.3 ? stepq(Math.sin((ph / 0.3) * Math.PI), 4) * 0.22 : 0
      }
      site.update({
        time: t,
        pace,
        damage: siteDamage(local),
        jolt: env.siteHit,
        jiggle: Math.min(1.5, jiggle),
        hop,
        healthy: segment(local, T.refill[0], T.refill[1]),
      })

      // ------------------------------------------------------------ floor + backdrop
      const wave = local >= T.refill[0] && local < T.refill[1] ? segment(local, T.refill[0], T.refill[1]) * 13 : -1
      floor.update({
        time: t,
        pace,
        srcX: lay.bossX,
        corrupt: segment(local, T.fire[0] + 0.01, T.shield[0]),
        siteX: lay.siteX,
        safe: build,
        wave,
        clean: local >= T.refill[1] ? 1 : 0,
      })
      const mood = local < T.shield[0] ? 0 : local < T.boom ? 1 : 2
      _band.copy(_bottom).lerp(_top, 0.45)
      back.update(t, pace, mood, dawn, _band)

      px.end()

      // ------------------------------------------------------------ HUD
      hud.update(local, time, rm, sHP, bHP)
      const cam = ctx.camera
      const ok = !fresh
      shieldTag.update(
        _a.set(lay.siteX - 0.2, SHIELD_R + 0.05, SHIELD_Z),
        cam,
        frame.width,
        frame.height,
        ok ? window01(local, T.shieldTag[0], T.shieldTag[1], 0.012) : 0,
      )
      weakTag.update(_b.copy(_core), cam, frame.width, frame.height, ok && alive ? window01(local, T.weakTag[0], T.weakTag[1], 0.012) : 0)
    },

    camera(local, frame, out) {
      computePose(local, frame.time, pose, frame.reducedMotion)
      out.position.copy(pose.position)
      out.target.copy(pose.target)
      out.fov = pose.fov
      out.roll = pose.roll
      out.parallax = pose.parallax
      fresh = false
    },

    anchors: [T.cta],
  }
}
