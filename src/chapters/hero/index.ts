import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { P } from '../../kit/pixel'
import { Backdrop, type BackdropState, CELL } from './scene'
import { Mark } from './mark'
import { Pickups, twinkle } from './pickups'
import { HeroUI, type HeroUIState, dialogOn } from './ui'
import { BEAT, HeroPose, PAYOFF, computePose, flyWeight } from './layout'
import { bounceDrop, stepped } from './util'
import './hero.css'

/*
 * 01 · TITLE SCREEN — the arcade attract mode.
 *
 * A synthwave-meets-16-bit horizon: banded dusk sky with pixel stars, a big
 * striped sun, neon ridges, a lit pixel city and a scrolling perspective grid.
 * The Hark mark is the GAME LOGO: when the loader hands over it drops in
 * from the top and bounces, the grid lights up row by row and a coin pops
 * out of it; the Hark.Digital wordmark and the tagline (the game's subtitle)
 * sit under it. PRESS START (scroll, click or Enter) and the mark hops,
 * spins and takes off: the camera races over the grid toward the city while
 * the mark leads on a coin trail, collecting coins, and narrates the
 * manifesto in a dialogue window (speaker HARK). The camera settles with
 * the mark eclipsing the sun, the headline and a game menu come up, then
 * READY? — the mark rockets into the sun and the iris closes on it.
 */

/** seconds of the reveal intro */
const INTRO = 1.9
/** intro beats (seconds) */
const DROP_AT = 0.18
const COIN_AT = 1.0
const COIN_DUR = 0.5

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _n = new THREE.Vector2()
const _cam = new THREE.Vector3()

export default function create(): Chapter {
  const group = new THREE.Group()
  const pose = new HeroPose()
  let back: Backdrop
  let mark: Mark
  let picks: Pickups
  let ui: HeroUI
  let reduced = false
  let mobile = false
  let active = false
  let revealed = false
  let introT = -1
  let introDone = false
  let lastLocal = -1
  let dialogT = 0
  let gridScroll = 0
  let shakeAt = -99
  let shakeAmp = 0
  let flashAt = -99
  let flashAmp = 0
  let pokeAt = -99
  let now = 0
  let curLocal = 0
  const ray = new THREE.Raycaster()
  const introCoin = { p: new THREE.Vector3(), life: 0, scale: 1 }
  // per-frame state objects, reused (no allocations in the frame loop)
  const bs: BackdropState = { reach: 0, front: 0, scroll: 0, gamePx: 4, stars: 1, sunScale: 1, sunPos: pose.sun, cam: pose.pos, calm: 0 }
  const us: HeroUIState = { local: 0, intro: 0, dialogT: 0, time: 0 }

  const shake = (amp: number) => {
    if (reduced) return
    shakeAt = now
    shakeAmp = amp
  }
  const flash = (amp: number) => {
    // rate-limited: scrubbing back and forth over PRESS START never strobes
    if (reduced || now - flashAt < 1.2) return
    flashAt = now
    flashAmp = amp
  }
  /**
   * PRESS START: play the run to the menu at an even pace (a plain land()
   * uses a front-loaded ease that blows through the flight in a blink).
   */
  const pressStart = () => {
    const hark = window.__hark
    const section = document.getElementById('hero')
    if (!hark) return
    if (reduced || !section) return hark.land('hero', true, PAYOFF)
    const y = section.offsetTop + PAYOFF * section.offsetHeight + 1
    hark.engine.lenis.scrollTo(y, { duration: 2.8, easing: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2), force: true })
  }

  return {
    id: 'hero',
    group,
    anchors: [PAYOFF],

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      mobile = ctx.mobile
      back = new Backdrop(reduced)
      group.add(back.group)
      await back.build(ctx.mobile, nextFrame)
      mark = new Mark()
      mark.root.visible = false
      group.add(mark.root)
      await nextFrame()
      picks = new Pickups(ctx.mobile)
      group.add(picks.group)
      ui = new HeroUI(ctx.stage)
      ui.onStart = pressStart
      ui.reduced = reduced

      const onReveal = () => {
        revealed = true
      }
      if (document.documentElement.dataset.ready === '1') onReveal()
      else window.addEventListener('hark:reveal', onReveal, { once: true })

      // Enter on the title screen = PRESS START (only when nothing has focus)
      window.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.repeat || !active || curLocal > 0.1) return
        const a = document.activeElement
        if (a && a !== document.body && a.id !== 'track') return
        e.preventDefault()
        pressStart()
      })
    },

    onEnter() {
      active = true
      lastLocal = -1
    },

    onLeave() {
      active = false
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      now = frame.time
      curLocal = local
      const aspect = frame.width / Math.max(1, frame.height)
      const jump = lastLocal < 0 || Math.abs(local - lastLocal) > 0.12
      const motion = reduced ? 0.3 : 1

      // ---- the reveal intro: plays once, for a visitor looking at the title
      if (active && revealed && !introDone && introT < 0) {
        if (local <= 0.1 && !reduced) introT = 0
        else introDone = true
      }
      if (introT >= 0 && !introDone) {
        introT += frame.dt
        if (introT >= INTRO || local > 0.1) introDone = true
      }
      const it = introDone ? INTRO + 1 : revealed ? Math.max(0, introT) : 0
      const introP = revealed ? clamp(it / INTRO) : 0

      // ---- beats as you scroll through them (never on a jump)
      if (active && !jump) {
        if (lastLocal < 0.1 && local >= 0.1) {
          shake(0.5)
          flash(0.28)
        }
        if (lastLocal < BEAT.setB && local >= BEAT.setB) shake(0.35)
      }
      if (active && introT >= 0 && !introDone && introT - frame.dt < DROP_AT + 0.36 && introT >= DROP_AT + 0.36) shake(0.45)
      if (active) lastLocal = local

      // ---- pose (camera + mark)
      computePose(local, aspect, ui.slots, frame.time, reduced, pose)
      const wFly = flyWeight(local)

      // intro drop from above the screen, with bounces
      const drop = bounceDrop(revealed ? it - DROP_AT : -1)
      const dropH = (1.08 - ui.slots.title.sy) * 10 * pose.tanV + pose.titleH * 0.7
      const titleW = 1 - smoothstep(0.1, 0.2, local)
      pose.markPos.addScaledVector(pose.up, drop.y * dropH * titleW)
      // a poke (click the logo): a little hop
      const pk = frame.time - pokeAt
      const hop = pk >= 0 && pk < 0.36 ? 4 * (pk / 0.36) * (1 - pk / 0.36) : 0
      pose.markPos.addScaledVector(pose.up, hop * 0.14 * pose.markScale)
      mark.root.visible = revealed || it > 0
      mark.root.position.copy(pose.markPos)
      mark.root.rotation.copy(pose.markRot)
      mark.root.scale.setScalar(pose.markScale)
      const sq = Math.max(pose.squash * 0.9, drop.squash * titleW, pk >= 0 && pk < 0.08 ? 0.5 : 0) * motion
      mark.body.scale.set(1 + 0.12 * sq, 1 - 0.16 * sq, 1)
      mark.body.position.y = -0.08 * sq
      // the gem spins on sprite frames and glints (held still + steady under reduced motion)
      mark.gem.rotation.y = reduced ? 0 : Math.floor(frame.time * 6) * (Math.PI / 4)
      mark.gemMat.color.setScalar(reduced ? 1 : 1 + 0.18 * (Math.sin(stepped(frame.time, 6) * 2.4) > 0.6 ? 1 : 0))
      // title shine sweep
      const settled = introDone || it > 1.3
      const sh = (frame.time % 3.6) / 0.7
      const still = local < BEAT.press || (local > BEAT.setB + 0.01 && local < BEAT.ready)
      mark.shine.value = settled && still && sh < 1 && !reduced ? -0.95 + sh * 1.9 : -9
      mark.root.updateMatrixWorld(true)

      // ---- sparkles + pickups
      const sp = picks.sparkles
      sp.begin()
      // intro / poke coin: pops out of the top of the mark
      const cT = it - COIN_AT
      const cP = pk - 0.05
      const coinLife = cT >= 0 && cT < COIN_DUR && !introDone ? cT / COIN_DUR : cP >= 0 && cP < COIN_DUR ? cP / COIN_DUR : -1
      if (coinLife >= 0) {
        mark.body.localToWorld(introCoin.p.set(0, mark.top + 0.05, 0.1))
        introCoin.p.addScaledVector(pose.up, pose.markScale * 0.2 * (1 - (1 - coinLife) * (1 - coinLife)))
        introCoin.life = coinLife
        introCoin.scale = pose.markScale * 0.36
      } else introCoin.life = 0
      picks.update(local, frame.time, pose.quat, wFly, coinLife >= 0 ? introCoin : null, reduced)
      // coin burst at the top of its arc
      const bT = coinLife < 0 ? Math.max(it - COIN_AT - COIN_DUR, pk - 0.05 - COIN_DUR) : -1
      if (bT >= 0 && bT < 0.6) {
        mark.body.localToWorld(_v.set(0, mark.top + 0.05, 0.1))
        _v.addScaledVector(pose.up, pose.markScale * 0.2)
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * Math.PI * 2
          _w.copy(_v).addScaledVector(pose.right, Math.cos(ang) * bT * 1.4 * pose.markScale * 0.4).addScaledVector(pose.up, Math.sin(ang) * bT * 1.4 * pose.markScale * 0.4)
          sp.add(_w, twinkle(bT * 0.9) * pose.markScale * 0.5, a % 2 ? P.gold : P.cyan, pose.quat)
        }
      }
      // the gem glints every few seconds (not under reduced motion); a landing glint on the intro
      if (mark.root.visible && wFly < 0.5) {
        const g = reduced ? -1 : (frame.time % 2.8) - 1.2
        const land = it - (DROP_AT + 0.4)
        const k = Math.max(twinkle(g), land >= 0 && land < 0.6 ? twinkle(land) * 1.3 : 0)
        if (k > 0) {
          mark.gem.getWorldPosition(_v)
          _cam.copy(pose.pos).sub(_v).normalize()
          _v.addScaledVector(_cam, 0.4 * pose.markScale)
          sp.add(_v, k * pose.markScale * 0.42, P.white, pose.quat)
        }
        // idle twinkles around the title logo (attract mode)
        if (settled && local < 0.1 && !reduced) {
          for (let s = 0; s < 2; s++) {
            const per = 1.9 + s * 0.7
            const cyc = Math.floor(frame.time / per + s * 0.5)
            const ph = frame.time / per + s * 0.5 - cyc
            const ang = cyc * 2.39996 + s * 3.1
            const rad = 0.62 + ((cyc * 7) % 3) * 0.06
            _w.copy(pose.markPos).addScaledVector(pose.right, Math.cos(ang) * rad * pose.markScale).addScaledVector(pose.up, Math.sin(ang) * rad * pose.markScale * 0.9)
            sp.add(_w, twinkle(ph * per - 0.2) * pose.markScale * 0.3, s ? P.cyan : P.gold, pose.quat)
          }
        }
      }
      sp.end()

      // ---- backdrop
      const rows = Math.floor(clamp((it - 0.02) / 1.05) * 72)
      const reach = introDone || !revealed ? (revealed ? 1e4 : 0) : 5 + rows * CELL
      const speed = (1 - wFly) * 2.2 * (reduced ? 0.25 : 1)
      gridScroll = (gridScroll + frame.dt * speed) % CELL
      const pixel = mobile ? 3 : 4
      bs.reach = reach
      bs.front = !introDone && revealed && it < 0.9 ? 1 : 0
      bs.scroll = gridScroll
      // the scene renders at the post pipeline's grid scale, not the canvas DPR
      bs.gamePx = pixel * ctx.post.scale
      bs.sunScale = 1 - 0.36 * smoothstep(BEAT.setA, BEAT.setB - 0.01, local)
      // reduced motion: windows steady on, beacons + star twinkles still
      bs.calm = reduced ? 1 : 0
      back.update(frame.time, bs)

      // ---- world light for the toon logo (from the upper left, toward the camera)
      const wp = ctx.world.params
      wp.top = P.void
      wp.bottom = P.night
      wp.stars = 0
      wp.keyDir.set(-0.55, 0.7, 0.85)
      wp.key = 2.9
      wp.fill = 0.8

      // ---- CRT
      const pp = ctx.post.params
      pp.pixel = pixel
      // only true whites/creams bloom (stars, the gem, the shine): big palette
      // areas would blow out to cream through the snap
      pp.bloomStrength = 0.5
      pp.bloomRadius = 0.25
      pp.bloomThreshold = 0.9
      pp.flash = Math.max(0, 1 - (frame.time - flashAt) / 0.14) * flashAmp
      pp.glitch = reduced ? 0 : 0.35 * smoothstep(0.95, 1, local) + (frame.time - flashAt < 0.12 ? 0.25 : 0)

      // the iris closes on the mark as it rockets into the sun
      if (active && local > 0.8) {
        pose.ndc(pose.markPos, _n)
        const k = smoothstep(0.8, 0.92, local)
        ctx.post.params.irisX = 0.5 + clamp(_n.x * 0.5, -0.4, 0.4) * k
        ctx.post.params.irisY = 0.5 + clamp(_n.y * 0.5, -0.4, 0.4) * k
      }

      // ---- DOM
      dialogT = dialogOn(local) ? dialogT + frame.dt : 0
      us.local = local
      us.intro = introP
      us.dialogT = dialogT
      us.time = frame.time
      ui.update(us)
    },

    camera(local: number, frame: Frame, out) {
      out.position.copy(pose.pos)
      out.target.copy(pose.tgt)
      out.fov = pose.fov
      out.roll = pose.roll
      out.parallax = reduced ? 0 : 0.32 * (1 - flyWeight(local))
      // screen shake (decays fast; jittered on 30 fps steps)
      const s = frame.time - shakeAt
      if (s >= 0 && s < 0.35 && shakeAmp > 0) {
        const a = shakeAmp * (1 - s / 0.35) ** 2 * 0.16
        const f = Math.floor(frame.time * 30)
        const jx = Math.sin(f * 12.9898) * 43758.5453
        const jy = Math.sin(f * 78.233) * 12345.6789
        _v.set((jx - Math.floor(jx) - 0.5) * 2 * a, (jy - Math.floor(jy) - 0.5) * 2 * a, 0)
        out.position.add(_v)
        out.target.add(_v)
      }
      back.follow(pose.pos)
    },

    onPointerDown(frame: Frame, ctx: ChapterContext) {
      if (!mark.root.visible || flyWeight(curLocal) > 0.1 || curLocal > 0.92) return
      ray.setFromCamera(frame.pointerRaw, ctx.camera)
      if (ray.intersectObject(mark.body, true).length) pokeAt = frame.time
    },
  }
}
