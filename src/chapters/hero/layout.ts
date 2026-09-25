import * as THREE from 'three'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { SUN, START_Z } from './scene'
import { bump, outBack, stepped } from './util'

/*
 * Story timing, the camera path and where the mark sits — all pure functions
 * of local progress (plus viewport slots and the idle clock), so any local
 * can be jumped to directly.
 *
 *   0.00–0.10  TITLE: attract-mode title card (logo, wordmark, the tagline as
 *              the game's subtitle, PRESS START), camera idles at the start
 *   0.10–0.22  PRESS START: the mark hops, spins and drops into the player slot
 *   0.10–0.60  FLIGHT: the camera races over the grid toward the city; the
 *              mark leads on a coin trail and collects coins as it goes
 *   0.20–0.52  HARK's dialogue window types the manifesto
 *   0.49–0.62  SETTLE: the mark swoops up, spins into place in front of the
 *              sun and lands with a squash
 *   0.60–0.93  PAYOFF: headline + game menu
 *   0.93–1     READY?: the mark rockets into the sun, the iris closes on it
 */

/** story beats (local), shared by the pose, the chapter and the DOM layer */
export const BEAT = {
  /** PRESS START */
  press: 0.1,
  /** the title card's wordmark + tagline hold until here */
  titleOut: 0.12,
  /** HARK's dialogue window */
  dlgA: 0.2,
  dlgB: 0.52,
  /** the mark swoops from the trail into the payoff slot */
  setA: 0.49,
  setB: 0.62,
  /** headline + menu */
  payA: 0.6,
  /** READY? */
  ready: 0.93,
} as const

export const PAYOFF = 0.78
export const Z_SETTLE = -74
/** how far ahead of the camera the mark flies */
export const AHEAD = 6.5
/** the mark's bounding height incl. outline (mark space) */
export const MARK_H = 1.08
const FLY_A = 0.1
const FLY_B = 0.6
/** the coin trail's mid height and swing (world y) */
const TRAIL_Y = 1.72
const TRAIL_SWING = 0.28
/** camera height in flight */
const Y_FLY = 2.62

export interface Slot {
  /** centre in NDC */
  sx: number
  sy: number
  /** height as a fraction of the viewport height */
  frac: number
}
export interface Slots {
  title: Slot
  pay: Slot
  portrait: boolean
  /** NDC y of the chrome's safe top and of the dialogue window's top edge */
  safeTop: number
  dlgTop: number
}

/** the coin trail the mark follows during the flight (world x/y by world z) */
export const trailX = (z: number) => 2.0 * Math.sin((START_Z - z) * 0.1)
export const trailY = (z: number) => TRAIL_Y + TRAIL_SWING * Math.sin((START_Z - z) * 0.2 + 0.8)
const trailSlope = (z: number) => 0.2 * Math.cos((START_Z - z) * 0.1)

/** trapezoid velocity profile: accelerate, cruise, brake (s in 0..1 → 0..1) */
function travel(s: number, a = 0.2, b = 0.22) {
  const v = 1 / (1 - a / 2 - b / 2)
  if (s <= 0) return 0
  if (s >= 1) return 1
  if (s < a) return (v * s * s) / (2 * a)
  if (s < 1 - b) return v * (a / 2 + (s - a))
  return 1 - (v * (1 - s) * (1 - s)) / (2 * b)
}

export function camZ(local: number) {
  let z = START_Z - 1.2 * clamp(local / FLY_A)
  z -= (START_Z - 1.2 - Z_SETTLE) * travel(segment(local, FLY_A, FLY_B))
  z -= 2.4 * smoothstep(FLY_B, BEAT.ready, local)
  z -= 8 * ease.inCubic(segment(local, BEAT.ready, 1))
  return z
}
export const markFlyZ = (local: number) => camZ(local) - AHEAD

/** 0..1 how much of the flight rig is in effect */
export const flyWeight = (local: number) => smoothstep(0.12, 0.26, local) * (1 - smoothstep(BEAT.setA - 0.01, BEAT.setB - 0.01, local))

/** the sun sits low behind the title logo and rides up to be eclipsed by the mark on the payoff */
export function sunPos(local: number, out: THREE.Vector3) {
  return out.copy(SUN).setY(lerp(SUN.y, 34, smoothstep(BEAT.setA - 0.05, BEAT.setB - 0.01, local)))
}

const _m = new THREE.Matrix4()
const _up = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()

/** the mark's depth in front of the camera on the title card and the payoff */
const DEPTH = 10
/** mark scale that fills `frac` of the viewport height at DEPTH */
const scaleFor = (frac: number, tanV: number) => (frac * 2 * DEPTH * tanV) / MARK_H

export class HeroPose {
  pos = new THREE.Vector3()
  tgt = new THREE.Vector3()
  fov = 44
  roll = 0
  quat = new THREE.Quaternion()
  right = new THREE.Vector3()
  up = new THREE.Vector3()
  fwd = new THREE.Vector3()
  tanV = 1
  tanH = 1
  markPos = new THREE.Vector3()
  markScale = 1
  markRot = new THREE.Euler(0, 0, 0, 'YXZ')
  /** the sun's centre this frame (it rides higher for the payoff eclipse) */
  sun = new THREE.Vector3()
  /** 0..1 landing squash */
  squash = 0
  /** title-slot world height (for the intro drop) */
  titleH = 1
  portrait = false

  /** world position of a point at NDC (sx, sy), `depth` in front of the camera */
  at(sx: number, sy: number, depth: number, out: THREE.Vector3) {
    return out
      .copy(this.pos)
      .addScaledVector(this.fwd, depth)
      .addScaledVector(this.right, sx * depth * this.tanH)
      .addScaledVector(this.up, sy * depth * this.tanV)
  }

  /** project a world point to NDC with this pose (no parallax) */
  ndc(p: THREE.Vector3, out: THREE.Vector2) {
    _v.copy(p).sub(this.pos)
    const z = _v.dot(this.fwd)
    if (z <= 1e-3) return out.set(0, 0)
    return out.set(_v.dot(this.right) / (z * this.tanH), _v.dot(this.up) / (z * this.tanV))
  }
}

export function computePose(local: number, aspect: number, slots: Slots, time: number, reduced: boolean, out: HeroPose) {
  const port = slots.portrait
  out.portrait = port
  const w1 = smoothstep(0.1, 0.24, local)
  const w2 = smoothstep(BEAT.setA, BEAT.setB - 0.01, local)
  const wr = ease.inCubic(segment(local, BEAT.ready, 1))
  const wFly = flyWeight(local)

  // ---- lens: a little wider (speed) in flight, long at the payoff, warp at the end
  const fovT = port ? 58 : 44
  const fovS = port ? 50 : 36
  out.fov = lerp(lerp(fovT, fovT + 8, w1), fovS, w2) + 14 * wr
  out.tanV = Math.tan((out.fov * Math.PI) / 360)
  out.tanH = out.tanV * aspect

  // ---- position
  const z = camZ(local)
  let y = lerp(2.3, Y_FLY, w1)
  y = lerp(y, 1.9, w2)
  const follow = port ? 0.9 : 0.55
  const x = trailX(z - AHEAD) * follow * wFly
  out.pos.set(x, y, z)

  // ---- orientation (yaw/pitch, blended by phase)
  const hyT = port ? -0.2 : -0.3
  const pitchT = Math.atan(-hyT * out.tanV)
  // flight: horizon a little above centre so the coin trail reads ahead of the
  // mark; on short viewports tip down further so the mark (with its trail
  // swing) flies clear above HARK's dialogue window, never higher than the
  // middle of the band between the chrome and the window
  const sF = port ? 0.98 : 1.15
  const aM = Math.atan2(TRAIL_Y - Y_FLY, AHEAD)
  let pitchF = Math.atan(-(port ? 0.22 : 0.12) * out.tanV)
  const unit = AHEAD * out.tanV
  const cur = Math.tan(aM - pitchF) / out.tanV
  const need = slots.dlgTop + (sF * MARK_H * 0.5 + TRAIL_SWING) / unit + 0.05
  const room = (slots.dlgTop + slots.safeTop) * 0.5
  const fly = Math.max(cur, Math.min(need, room))
  if (fly > cur) pitchF = aM - Math.atan(fly * out.tanV)
  sunPos(local, out.sun)
  _v.copy(out.sun).sub(out.pos)
  const yawSun = Math.atan2(_v.x, -_v.z)
  const pitchSun = Math.atan2(_v.y, Math.hypot(_v.x, _v.z))
  const yawS = yawSun - Math.atan(slots.pay.sx * out.tanH)
  const pitchS = pitchSun - Math.atan(slots.pay.sy * out.tanV)
  const yawF = trailSlope(z - AHEAD) * 0.25 * wFly
  let yaw = lerp(lerp(0, yawF, w1), yawS, w2)
  let pitch = lerp(lerp(pitchT, pitchF, w1), pitchS, w2)
  // READY: tip toward the sun as the mark rockets into it
  yaw = lerp(yaw, yawSun, wr * 0.6)
  pitch = lerp(pitch, pitchSun, wr * 0.6)
  out.tgt.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(50).add(out.pos)
  out.roll = -trailSlope(z - AHEAD) * 0.35 * wFly

  _m.lookAt(out.pos, out.tgt, _up)
  out.quat.setFromRotationMatrix(_m)
  _m.extractBasis(out.right, out.up, _v)
  out.fwd.copy(_v).negate()

  // ---- the mark
  const motion = reduced ? 0.3 : 1
  const st = stepped(time, 10)
  const pT = out.at(slots.title.sx, slots.title.sy, DEPTH, _a)
  const sT = scaleFor(slots.title.frac, out.tanV)
  out.titleH = sT * MARK_H
  const zm = z - AHEAD
  const pF = _b.set(trailX(zm), trailY(zm), zm)
  const pP = out.at(slots.pay.sx, slots.pay.sy, DEPTH, _c)
  const sP = scaleFor(slots.pay.frac, out.tanV)
  const m1 = ease.inOutCubic(segment(local, 0.1, 0.22))
  const s2 = segment(local, BEAT.setA, BEAT.setB)
  const m2 = outBack(s2, 1.4)
  out.markPos.copy(pT).lerp(pF, m1)
  out.markPos.lerp(pP, m2)
  out.markScale = lerp(lerp(sT, sF, m1), sP, m2)
  // a hop on PRESS START, a swoop up into the payoff
  out.markPos.addScaledVector(out.up, bump(local, 0.1, 0.19) * 0.55 * sT)
  out.markPos.y += bump(local, BEAT.setA, BEAT.setB) * 1.1
  // idle hover (sprite-stepped), calmer while flying
  const idle = 1 - 0.6 * wFly
  out.markPos.addScaledVector(out.up, Math.sin(st * 2.4) * 0.022 * out.markScale * idle * motion)
  // READY: rocket toward the sun
  if (wr > 0) {
    _v.copy(out.sun).sub(out.markPos).normalize()
    out.markPos.addScaledVector(_v, wr * 90)
  }

  const spin1 = ease.inOutCubic(segment(local, 0.1, 0.2)) * Math.PI * 2
  const spin2 = ease.inOutCubic(segment(local, BEAT.setA + 0.02, BEAT.setB - 0.01)) * Math.PI * 2
  const sway = Math.sin(st * 1.3) * 0.16 * motion * (1 - wFly)
  // face the camera like a sprite (no side walls), with a slight down-right
  // tilt on the title/payoff so the gold extrusion reads like a 3D title logo
  _v.copy(out.pos).sub(out.markPos).normalize()
  const faceYaw = Math.atan2(_v.x, _v.z)
  const facePitch = -Math.asin(clamp(_v.y, -1, 1))
  const still = 1 - wFly
  out.markRot.set(
    facePitch - 0.13 * still - 0.06 * wFly,
    faceYaw - 0.1 * still + sway + spin1 + spin2 + wr * Math.PI * 3,
    out.roll + trailSlope(zm) * -0.9 * wFly,
    'YXZ',
  )
  out.squash = bump(local, BEAT.setB - 0.02, BEAT.setB + 0.025)
  return out
}
