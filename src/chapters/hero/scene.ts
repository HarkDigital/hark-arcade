import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { P } from '../../kit/pixel'
import { rng } from '../../core/math'
import type { Yielder } from './util'

/*
 * The attract-mode horizon, back to front:
 *   sky     banded synthwave dusk (void → night → indigo → purple → magenta →
 *           coral at the horizon) with twinkling pixel stars; the CRT's palette
 *           snap + Bayer dither turns the gradient into hard bands
 *   sun     big striped sun, stripes drifting down (classic)
 *   ridges  two mountain silhouettes with neon rims
 *   city    neon skyline: merged boxes + lit windows (a few flicker) and
 *           rooftop beacons, one draw call each
 *   floor   the scrolling perspective grid (lines stay >= 1 game pixel wide,
 *           fade before they moire; lights up row by row on the intro)
 */

export const SUN = new THREE.Vector3(0, 16, -430)
export const SUN_R = 100
/** grid cell size (world units) */
export const CELL = 2
/** world z where the camera starts (the intro lights the grid outward from here) */
export const START_Z = 16

const lin = (hex: string) => new THREE.Color(hex)

const HASH = /* glsl */ `
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uStars: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 0, -1) },
      uSunCos: { value: 0.97 },
      c0: { value: lin(P.coral) },
      c1: { value: lin(P.magenta) },
      c2: { value: lin(P.purple) },
      c3: { value: lin(P.indigo) },
      c4: { value: lin(P.night) },
      c5: { value: lin(P.void) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStars, uSunCos;
      uniform vec3 uSunDir;
      uniform vec3 c0, c1, c2, c3, c4, c5;
      varying vec3 vDir;
      ${HASH}
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        vec3 c = c0;
        c = mix(c, c1, smoothstep(0.0, 0.05, e));
        c = mix(c, c2, smoothstep(0.08, 0.17, e));
        c = mix(c, c3, smoothstep(0.19, 0.33, e));
        c = mix(c, c4, smoothstep(0.35, 0.5, e));
        c = mix(c, c5, smoothstep(0.52, 0.78, e));
        // warm halo around the sun (dithers into rings through the CRT palette)
        float sa = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        float sr = acos(uSunCos);
        float halo = 1.0 - smoothstep(sr * 1.0, sr * 1.75, sa);
        c = mix(c, c1, halo * 0.8);
        c = mix(c, c0, (1.0 - smoothstep(sr * 1.0, sr * 1.28, sa)) * 0.55);
        // pixel stars on a lat/long grid (cells ~2 game px at the hero fov)
        vec2 g = vec2(atan(d.z, d.x), asin(clamp(e, -1.0, 1.0))) * 150.0;
        vec2 cell = floor(g);
        float r = hash(cell);
        float star = step(0.9935, r) * smoothstep(0.1, 0.26, e) * uStars;
        // a few stars twinkle on stepped timing (sprite-style, 3 fps)
        float tw = step(0.9975, r) * step(0.55, hash(cell + floor(uTime * 3.0 + r * 11.0)));
        // most stars are dim steel, one in four is a bright one
        vec3 sc = mix(vec3(0.33, 0.37, 0.56), vec3(1.0), step(0.9982, r));
        sc = mix(sc, c3, tw);
        c = mix(c, sc, star);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
}

function sunMaterial() {
  return new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      cA: { value: lin(P.gold) },
      cB: { value: lin(P.orange) },
      cC: { value: lin(P.coral) },
      cD: { value: lin(P.magenta) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 cA, cB, cC, cD;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float t = 0.5 - p.y * 0.5; // 0 top .. 1 bottom
        vec3 c = mix(cA, cB, smoothstep(0.28, 0.46, t));
        c = mix(c, cC, smoothstep(0.5, 0.66, t));
        c = mix(c, cD, smoothstep(0.72, 0.92, t));
        // stripes in the lower half, thickening toward the bottom, drifting down
        float s = 0.22 - p.y;
        float ph = fract((s - uTime * 0.035) / 0.15);
        float gap = clamp(s * 0.5, 0.0, 0.62);
        if (s > 0.0 && ph < gap) discard;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
}

function floorMaterial() {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      uCell: { value: CELL },
      uScroll: { value: 0 },
      uGamePx: { value: 4 },
      uReach: { value: 1e4 },
      uFront: { value: 0 },
      uStartZ: { value: START_Z },
      cBase: { value: lin(P.void) },
      cFar: { value: lin(P.night) },
      cHaze: { value: lin(P.purple) },
      cLine: { value: lin(P.magenta) },
      cLineFar: { value: lin(P.coral) },
      cFrontC: { value: lin(P.cyan) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uCell, uScroll, uGamePx, uReach, uFront, uStartZ;
      uniform vec3 cBase, cFar, cHaze, cLine, cLineFar, cFrontC;
      varying vec3 vW;
      void main() {
        vec2 g = vec2(vW.x + uCell * 0.5, vW.z - uScroll);
        vec2 fw = max(fwidth(g), vec2(1e-4));
        vec2 f = abs(fract(g / uCell - 0.5) - 0.5) * uCell;
        // at least ~1 game pixel wide on screen so lines never crawl
        vec2 hw = max(vec2(0.05), fw * uGamePx * 0.5);
        vec2 l = 1.0 - smoothstep(hw, hw + fw, f);
        // fade lines out before the cells get small enough to moire
        vec2 fade = 1.0 - smoothstep(uCell * 0.16, uCell * 0.36, fw * uGamePx);
        l *= fade;
        float dist = length(vW.xz - cameraPosition.xz);
        float fromStart = uStartZ - vW.z;
        float lit = step(fromStart, uReach);
        float line = max(l.x, l.y) * lit;
        vec3 base = mix(cBase, cFar, smoothstep(24.0, 150.0, dist));
        base = mix(base, cHaze, smoothstep(150.0, 330.0, dist));
        vec3 lc = mix(cLine, cLineFar, smoothstep(150.0, 320.0, dist));
        // the row being lit on the intro burns cyan
        float front = uFront * step(abs(fromStart - uReach + uCell * 1.5), uCell * 1.5);
        lc = mix(lc, cFrontC, front);
        gl_FragColor = vec4(mix(base, lc, line), 1.0);
      }
    `,
  })
}

function windowMaterial() {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float aMode;
      attribute float aSeed;
      varying vec3 vCol;
      varying float vMode, vSeed;
      void main() {
        vCol = color;
        vMode = aMode;
        vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vCol;
      varying float vMode, vSeed;
      ${HASH}
      void main() {
        float on = 1.0;
        // mode 1: a window that flicks on/off every couple of seconds
        float flick = step(0.45, hash(vec2(vSeed * 91.0, floor(uTime * 0.55 + vSeed * 7.0))));
        // mode 2: a rooftop beacon, slow stepped blink
        float blink = step(0.5, fract(uTime * 0.7 + vSeed));
        on = vMode < 0.5 ? 1.0 : (vMode < 1.5 ? flick : blink);
        if (on < 0.5) discard;
        gl_FragColor = vec4(vCol, 1.0);
      }
    `,
  })
}

/** Quad facing +z centred at (x, y, z), written into arrays. */
function pushQuad(pos: number[], cols: number[], extra: number[][], x: number, y: number, z: number, w: number, h: number, c: THREE.Color, attrs: number[]) {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2
  pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z)
  for (let i = 0; i < 6; i++) {
    cols.push(c.r, c.g, c.b)
    attrs.forEach((a, k) => extra[k].push(a))
  }
}

function colored(geo: THREE.BufferGeometry, c: THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  return g
}

/** A box with different colours for front, sides and top. */
function box(x: number, y0: number, z: number, w: number, h: number, d: number, front: THREE.Color, side: THREE.Color, top: THREE.Color) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed()
  g.translate(x, y0 + h / 2, z - d / 2)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  const nor = g.attributes.normal
  for (let i = 0; i < n; i++) {
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i)
    const c = ny > 0.5 ? top : nz > 0.5 ? front : Math.abs(nx) > 0.5 ? side : front
    arr.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  return g
}

/** Mountain ridge as a filled silhouette + a neon rim ribbon. */
function ridge(seed: number, z: number, fill: THREE.Color, rim: THREE.Color, peaks: number, hMin: number, hMax: number, valley: number, rimW: number) {
  const r = rng(seed)
  const pk: { x: number; h: number; s: number }[] = []
  for (let i = 0; i < peaks; i++) {
    const side = i % 2 ? 1 : -1
    const x = side * (valley + r() * 520)
    pk.push({ x, h: hMin + r() * (hMax - hMin), s: 0.35 + r() * 0.5 })
  }
  const pts: number[] = []
  for (let x = -760; x <= 760; x += 8) {
    let h = 3 + r() * 1.2
    for (const p of pk) h = Math.max(h, p.h - Math.abs(x - p.x) * p.s)
    // keep the valley under the sun low
    h *= 0.35 + 0.65 * Math.min(1, Math.abs(x) / (valley * 1.4))
    pts.push(x, Math.round(h / 1.5) * 1.5)
  }
  const pos: number[] = []
  const cols: number[] = []
  const quad = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, c: THREE.Color) => {
    pos.push(ax, ay, z, bx, by, z, cx, cy, z, ax, ay, z, cx, cy, z, dx, dy, z)
    for (let i = 0; i < 6; i++) cols.push(c.r, c.g, c.b)
  }
  for (let i = 0; i < pts.length - 2; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3]
    quad(x0, -6, x1, -6, x1, y1, x0, y0, fill)
    // rim sits in front of the fill, a hair closer to the camera
    pos.push(x0, y0 - rimW, z + 0.2, x1, y1 - rimW, z + 0.2, x1, y1, z + 0.2, x0, y0 - rimW, z + 0.2, x1, y1, z + 0.2, x0, y0, z + 0.2)
    for (let k = 0; k < 6; k++) cols.push(rim.r, rim.g, rim.b)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  return g
}

export class Backdrop {
  group = new THREE.Group()
  sky: THREE.Mesh
  sun!: THREE.Mesh
  private skyMat = skyMaterial()
  private sunMat = sunMaterial()
  private floorMat = floorMaterial()
  private winMat = windowMaterial()

  constructor() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), this.skyMat)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -9
    this.group.add(this.sky)
  }

  async build(mobile: boolean, yieldNow: Yielder) {
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(SUN_R * 2, SUN_R * 2), this.sunMat)
    sun.position.copy(SUN)
    sun.renderOrder = -8
    this.sun = sun
    this.group.add(sun)

    // ridges (one merged mesh)
    const ridges = mergeGeometries([
      ridge(11, -372, lin(P.purple), lin(P.coral), 14, 22, 58, 70, 1.6),
      ridge(29, -318, lin(P.indigo), lin(P.magenta), 16, 12, 34, 56, 1.3),
    ])
    const ridgeMesh = new THREE.Mesh(ridges, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
    ridgeMesh.renderOrder = -7
    this.group.add(ridgeMesh)
    await yieldNow()

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 380), this.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, START_Z + 14 - 190)
    this.group.add(floor)

    this.buildCity(mobile)
    await yieldNow()
  }

  private buildCity(mobile: boolean) {
    const r = rng(2016)
    const boxes: THREE.BufferGeometry[] = []
    const wp: number[] = []
    const wc: number[] = []
    const wx: number[][] = [[], []]
    const winCols = [lin(P.gold), lin(P.gold), lin(P.gold), lin(P.cream), lin(P.cyan), lin(P.cyan), lin(P.coral)]
    const night = lin(P.night), vd = lin(P.void), indigo = lin(P.indigo), purple = lin(P.purple)
    const neon = [lin(P.magenta), lin(P.cyan), lin(P.coral)]
    const rows: { z0: number; zj: number; x0: number; x1: number; w: [number, number]; h: [number, number]; gap: number; front: THREE.Color; side: THREE.Color; top: THREE.Color; lit: number; far: boolean }[] = [
      { z0: -196, zj: 12, x0: -170, x1: 170, w: [7, 13], h: [16, 40], gap: 7, front: indigo, side: night, top: purple, lit: 0.18, far: true },
      { z0: -150, zj: 9, x0: -150, x1: 150, w: [5, 11], h: [6, 22], gap: 10, front: night, side: vd, top: indigo, lit: 0.34, far: false },
    ]
    const beacons: THREE.Vector3[] = []
    for (const row of rows) {
      let x = row.x0
      const stepMul = mobile ? 1.35 : 1
      while (x < row.x1) {
        const w = row.w[0] + r() * (row.w[1] - row.w[0])
        const cx = x + w / 2
        x += (w + 0.6 + r() * 2.2) * stepMul
        if (Math.abs(cx) < row.gap + w / 2) continue
        const edge = Math.min(1, Math.abs(cx) / 60)
        let h = row.h[0] + r() * (row.h[1] - row.h[0]) * (0.45 + 0.55 * edge)
        h = Math.round(h / 1.9) * 1.9 + 1.2
        const z = row.z0 - r() * row.zj
        const d = 7
        boxes.push(box(cx, 0, z, w, h, d, row.front, row.side, row.top))
        // a stepped setback crown on some towers
        if (h > 18 && r() < 0.5) {
          const cw = w * (0.45 + r() * 0.2)
          const ch = 1.9 * (1 + Math.floor(r() * 3))
          boxes.push(box(cx, h, z - 1, cw, ch, d - 2, row.front, row.side, row.top))
          if (!row.far && r() < 0.8) beacons.push(new THREE.Vector3(cx, h + ch + 2.4, z - 1.5))
        }
        // neon roof strip on some of the front row
        if (!row.far && r() < 0.34) {
          const nc = neon[Math.floor(r() * neon.length)]
          boxes.push(colored(new THREE.BoxGeometry(w, 0.55, 0.3).translate(cx, h - 0.3, z + 0.16), nc))
        }
        // windows
        const cols = Math.max(1, Math.floor((w - 1) / 1.55))
        const nrows = Math.max(1, Math.floor((h - 2.2) / 1.9))
        const ox = cx - ((cols - 1) * 1.55) / 2
        for (let j = 0; j < nrows; j++) {
          for (let i = 0; i < cols; i++) {
            if (r() > row.lit) continue
            const c = row.far ? (r() < 0.6 ? purple : winCols[Math.floor(r() * winCols.length)]) : winCols[Math.floor(r() * winCols.length)]
            const flick = r() < 0.07 ? 1 : 0
            pushQuad(wp, wc, wx, ox + i * 1.55, 1.8 + j * 1.9, z + 0.05, 0.85, 1.05, c, [flick, r()])
          }
        }
      }
    }
    // rooftop masts + beacons
    for (const b of beacons) {
      boxes.push(colored(new THREE.BoxGeometry(0.35, 3, 0.35).translate(b.x, b.y - 1.9, b.z), vd))
      pushQuad(wp, wc, wx, b.x, b.y, b.z + 0.3, 0.9, 0.9, lin(P.coral), [2, r()])
    }
    const bmesh = new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
    boxes.forEach(b => b.dispose())
    bmesh.renderOrder = -6
    this.group.add(bmesh)
    const wg = new THREE.BufferGeometry()
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3))
    wg.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3))
    wg.setAttribute('aMode', new THREE.Float32BufferAttribute(wx[0], 1))
    wg.setAttribute('aSeed', new THREE.Float32BufferAttribute(wx[1], 1))
    const wmesh = new THREE.Mesh(wg, this.winMat)
    wmesh.renderOrder = -5
    this.group.add(wmesh)
  }

  /** Per frame: idle clocks + the grid's intro reach / scroll. */
  update(time: number, o: { reach: number; front: number; scroll: number; gamePx: number; stars: number; sunScale: number; sunPos: THREE.Vector3; cam: THREE.Vector3 }) {
    this.skyMat.uniforms.uTime.value = time
    this.skyMat.uniforms.uStars.value = o.stars
    if (this.sun) {
      this.sun.scale.setScalar(o.sunScale)
      this.sun.position.copy(o.sunPos)
      const d = this.sun.position.clone().sub(o.cam)
      const dist = d.length()
      this.skyMat.uniforms.uSunDir.value.copy(d.normalize())
      this.skyMat.uniforms.uSunCos.value = Math.cos(Math.atan((SUN_R * o.sunScale) / dist))
    }
    this.sunMat.uniforms.uTime.value = time
    this.winMat.uniforms.uTime.value = time
    const f = this.floorMat.uniforms
    f.uReach.value = o.reach
    f.uFront.value = o.front
    f.uScroll.value = o.scroll
    f.uGamePx.value = o.gamePx
  }

  /** Keep the sky dome on the camera. */
  follow(cam: THREE.Vector3) {
    this.sky.position.copy(cam)
  }
}
