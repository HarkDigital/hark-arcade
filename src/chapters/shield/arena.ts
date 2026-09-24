import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { P, toon } from '../../kit/pixel'
import { hash1, stepq } from './timeline'

/*
 * The boss room: a checkerboard tile floor that corrupts magenta under the
 * attack and gets cleansed green in a wave after the win, a skyline of
 * server racks with blinking LEDs behind it, and a huge pixel moon that
 * turns from blood-red to a gold sunrise.
 */

const TILE = 0.5
const X0 = -13
const X1 = 13
const Z0 = -4
const Z1 = 10

const C_A = new THREE.Color(P.indigo)
const C_B = new THREE.Color(P.night)
const C_BAD_A = new THREE.Color(P.magenta)
const C_BAD_B = new THREE.Color(P.purple)
const C_SAFE_A = new THREE.Color(P.pine)
const C_SAFE_B = new THREE.Color(P.night)
const C_WAVE = new THREE.Color(P.signal).multiplyScalar(1.2)

export interface FloorState {
  time: number
  pace: number
  /** world x/z the corruption spreads from (the boss) */
  srcX: number
  /** 0..1 corruption spread */
  corrupt: number
  /** site x (the safe zone / cleanse origin) */
  siteX: number
  /** 0..1 shield safe zone under the dome */
  safe: number
  /** radius of the cleanse wave front (world units), -1 = none */
  wave: number
  /** 1 once everything is clean */
  clean: number
}

export class Floor {
  mesh: THREE.InstancedMesh
  bed: THREE.Mesh
  private tiles: { x: number; z: number; odd: boolean; h: number }[] = []
  private _c = new THREE.Color()

  constructor() {
    const geo = new THREE.BoxGeometry(TILE * 0.94, 0.14, TILE * 0.94)
    geo.translate(0, -0.07, 0)
    for (let x = X0; x <= X1 + 1e-6; x += TILE) {
      for (let z = Z0; z <= Z1 + 1e-6; z += TILE) {
        const ix = Math.round(x / TILE)
        const iz = Math.round(z / TILE)
        this.tiles.push({ x, z, odd: ((ix + iz) & 1) === 1, h: hash1(ix * 13.1 + iz * 7.7) })
      }
    }
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toon('#ffffff').gradientMap }),
      this.tiles.length,
    )
    const m = new THREE.Matrix4()
    this.tiles.forEach((t, i) => {
      m.makeTranslation(t.x, 0, t.z)
      this.mesh.setMatrixAt(i, m)
      this.mesh.setColorAt(i, t.odd ? C_A : C_B)
    })
    this.mesh.frustumCulled = false
    // a solid bed under the tiles so the grout never shows the sky
    // (it runs far toward the camera: portrait framings sit the camera far back)
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), new THREE.MeshBasicMaterial({ color: P.night }))
    this.bed.rotation.x = -Math.PI / 2
    this.bed.position.set(0, -0.1, Z0 + 60 - 0.25)
  }

  update(st: FloorState) {
    const flick = st.pace > 0 ? Math.floor(st.time * 8) : 0
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i]
      const c = this._c.copy(t.odd ? C_A : C_B)
      // corruption: a ragged blob spreading from under the boss
      const dB = Math.hypot(t.x - st.srcX, (t.z - 0.2) * 1.5)
      const reach = st.corrupt * 6.8 - t.h * 1.4
      let bad = dB < reach
      // the shield's footprint stays safe
      const dS = Math.hypot(t.x - st.siteX, t.z * 1.4)
      const safe = st.safe > 0 && dS < 1.7 * st.safe
      if (safe) bad = false
      if (st.clean >= 1) bad = false
      if (st.wave >= 0 && dS < st.wave) bad = false
      if (bad) {
        c.copy(t.odd ? C_BAD_A : C_BAD_B)
        if (t.h > 0.8 && hash1(flick + t.h * 50) > 0.6) c.set(P.coral)
      } else if (safe) c.copy(t.odd ? C_SAFE_A : C_SAFE_B)
      if (st.wave >= 0 && Math.abs(dS - st.wave) < 0.45) c.copy(C_WAVE)
      this.mesh.setColorAt(i, c)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

/* ------------------------------------------------------------ backdrop */

export class Backdrop {
  group = new THREE.Group()
  racks: THREE.Mesh
  leds: THREE.InstancedMesh
  moon: THREE.Mesh
  private moonMat: THREE.MeshBasicMaterial
  private bands: THREE.Mesh
  private bandMat: THREE.MeshBasicMaterial
  private ledList: { x: number; y: number; z: number; h: number }[] = []
  private _m = new THREE.Matrix4()
  private _c = new THREE.Color()

  constructor(mobile: boolean) {
    // server racks: two rows of dark towers at different depths (parallax)
    const geos: THREE.BufferGeometry[] = []
    const rows = [
      { z: -6.5, n: mobile ? 9 : 12, hMin: 1.2, hMax: 3.0, span: 24 },
      { z: -9.5, n: mobile ? 8 : 11, hMin: 2.2, hMax: 4.4, span: 32 },
    ]
    rows.forEach((row, ri) => {
      for (let i = 0; i < row.n; i++) {
        const h = row.hMin + hash1(i * 3.7 + ri * 11) * (row.hMax - row.hMin)
        const w = 0.9 + hash1(i * 5.1 + ri) * 0.8
        const x = -row.span / 2 + (i + 0.5) * (row.span / row.n) + (hash1(i * 9.3 + ri) - 0.5) * 0.5
        const g = new THREE.BoxGeometry(w, h, 0.8)
        g.translate(x, h / 2, row.z)
        geos.push(g)
        // LED columns on the front face
        const nl = Math.floor(h / 0.36)
        for (let k = 1; k < nl; k++) {
          for (const dx of [-w * 0.28, w * 0.1]) {
            if (hash1(i * 17 + k * 3.1 + dx * 7 + ri * 5) > 0.3) continue
            this.ledList.push({ x: x + dx, y: k * 0.36, z: row.z + 0.42, h: hash1(i * 7 + k * 13 + ri * 3 + dx) })
          }
        }
      }
    })
    this.racks = new THREE.Mesh(mergeGeometries(geos), toon(P.night))
    geos.forEach(g => g.dispose())
    this.leds = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.14, 0.09),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      this.ledList.length,
    )
    this.ledList.forEach((l, i) => {
      this._m.makeTranslation(l.x, l.y, l.z)
      this.leds.setMatrixAt(i, this._m)
      this.leds.setColorAt(i, this._c.set(P.coral))
    })
    this.leds.frustumCulled = false

    // the moon / sun: a flat pixel disc with horizon slices
    this.moonMat = new THREE.MeshBasicMaterial({ color: P.steel, toneMapped: false })
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(3.6, 40), this.moonMat)
    this.moon.position.set(1.8, 4.8, -14)
    this.bandMat = new THREE.MeshBasicMaterial({ color: P.void, toneMapped: false })
    const bandGeos: THREE.BufferGeometry[] = []
    ;[0.34, 0.2, 0.1].forEach((th, i) => {
      const g = new THREE.PlaneGeometry(8, th)
      g.translate(0, -1.2 - i * 0.62, 0.01)
      bandGeos.push(g)
    })
    this.bands = new THREE.Mesh(mergeGeometries(bandGeos), this.bandMat)
    this.moon.add(this.bands)

    this.group.add(this.moon, this.racks, this.leds)
  }

  /**
   * `mood` 0 = red alert, 1 = shield (amber), 2 = restored (green); the moon
   * blends from blood-red to a gold sunrise with `dawn` 0..1.
   */
  update(time: number, pace: number, mood: number, dawn: number, bandColor: THREE.Color) {
    const tq = pace > 0 ? Math.floor(time * 6) : 0
    const cols = [P.coral, P.gold, P.signal]
    for (let i = 0; i < this.ledList.length; i++) {
      const l = this.ledList[i]
      const on = pace > 0 ? hash1(tq * 0.37 + l.h * 91) > 0.3 : l.h > 0.3
      const col = cols[Math.min(2, Math.max(0, Math.round(mood + (l.h - 0.5) * 0.4)))]
      this._c.set(on ? col : P.night)
      this.leds.setColorAt(i, this._c)
    }
    if (this.leds.instanceColor) this.leds.instanceColor.needsUpdate = true
    const d = stepq(dawn, 4)
    // a pale steel moon (the magenta boss reads as a silhouette against it,
    // and it stays under the bloom threshold) that turns into a gold sunrise
    this.moonMat.color.set(P.steel).lerp(this._c.set(P.gold), d)
    this.moon.position.y = 4.8 - d * 0.6
    this.bandMat.color.copy(bandColor)
  }
}
