import * as THREE from 'three'
import { P } from '../../kit/pixel'
import { rng } from '../../core/math'
import { Builder, R } from './builder'
import {
  COLS,
  ROWS,
  MAP,
  NODES,
  PLATEAU_H,
  RIVER_Y,
  SEA_Y,
  START,
  isLand,
  isRiver,
  isSea,
  tile,
  wx,
  wz,
} from './timeline'

/*
 * The island: terrain tiles, beaches, cliffs, the river, the plateau with its
 * stairs, forests, mountains and little props, all into one Builder (one
 * draw call + one outline hull). Water is a stepped-animation shader that
 * reads a distance-to-shore field, so foam hugs the coast in pixel steps.
 */

const BODY_Y = -1.3
const SLAB = 0.14

/** tiles nothing may be planted on (path, nodes, buildings), with a margin */
function blockedTiles() {
  const s = new Set<string>()
  const key = (c: number, r: number) => `${c},${r}`
  const add = (c: number, r: number, m = 0) => {
    for (let dc = -m; dc <= m; dc++) for (let dr = -m; dr <= m; dr++) s.add(key(Math.round(c) + dc, Math.round(r) + dr))
  }
  // the path, orthogonal runs between waypoints (+1 tile margin)
  const WAY: [number, number][] = [
    [4, 15], [4, 12], [7, 12], [7, 14], [15, 14], [19, 14], [19, 7], [23, 7], [23, 13], [25, 13],
  ]
  for (let i = 1; i < WAY.length; i++) {
    const [c0, r0] = WAY[i - 1]
    const [c1, r1] = WAY[i]
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0))
    for (let k = 0; k <= n; k++) add(c0 + Math.sign(c1 - c0) * k, r0 + Math.sign(r1 - r0) * k, 1)
  }
  add(START.col, START.row, 1)
  for (const n of NODES) {
    add(n.col, n.row, 1)
    for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) add(n.bcol + dc, n.brow + dr)
  }
  // castle + crane footprint on the plateau
  for (let c = 16; c <= 23; c++) for (let r = 1; r <= 6; r++) add(c, r)
  // mountains
  for (let c = 1; c <= 9; c++) for (let r = 1; r <= 5; r++) add(c, r)
  // dock
  add(6, 17, 0)
  add(6, 16, 0)
  const onPath = new Set<string>()
  for (let i = 1; i < WAY.length; i++) {
    const [c0, r0] = WAY[i - 1]
    const [c1, r1] = WAY[i]
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0))
    for (let k = 0; k <= n; k++) onPath.add(key(c0 + Math.sign(c1 - c0) * k, r0 + Math.sign(r1 - r0) * k))
  }
  return { has: (c: number, r: number) => s.has(key(c, r)), path: (c: number, r: number) => onPath.has(key(c, r)) }
}

export function tileKind(c: number, r: number) {
  const t = tile(c, r)
  if (!isLand(t)) return t
  if (t === '^' || t === 'S') return t
  // lowland next to the sea is beach
  if (isSea(tile(c + 1, r)) || isSea(tile(c - 1, r)) || isSea(tile(c, r + 1)) || isSea(tile(c, r - 1))) return ','
  return t
}

/* ------------------------------------------------------------------ terrain */

function terrain(b: Builder, rand: () => number) {
  for (let r = 0; r < ROWS; r++) {
    let c = 0
    while (c < COLS) {
      const k = tileKind(c, r)
      if (!isLand(tile(c, r))) {
        c++
        continue
      }
      // merge a run of identical land tiles into one slab + body
      let run = 1
      const same = (kk: string) => kk === k && k !== 'S'
      while (c + run < COLS && isLand(tile(c + run, r)) && same(tileKind(c + run, r))) run++
      const top = k === '^' ? PLATEAU_H : 0
      const cx = wx(c) + (run - 1) / 2
      const z = wz(r)
      b.box(cx, BODY_Y, z, run, top - SLAB - BODY_Y, 1, R.cliff)
      b.box(cx, top - SLAB, z, run, SLAB, 1, k === ',' ? R.sand : R.grass)
      if (k === 'S') {
        // three stone steps up to the plateau (north edge)
        for (let s = 0; s < 3; s++) b.box(wx(c), 0, z + 0.5 - (s + 0.5) / 3, 0.84, ((s + 1) / 3) * PLATEAU_H, 1 / 3, R.stone, false)
      }
      c += run
    }
  }
  // river banks: a sandy lip where the land drops to the stream bed
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isRiver(tile(c, r))) continue
      b.box(wx(c), BODY_Y, wz(r), 1, RIVER_Y - 0.06 - BODY_Y, 1, R.dirt)
    }
  // rocky cliff texture on the sea-facing south cliffs + waterline stones
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isLand(tile(c, r)) || !isSea(tile(c, r + 1))) continue
      const n = 1 + Math.floor(rand() * 2)
      for (let i = 0; i < n; i++) {
        const x = wx(c) - 0.35 + rand() * 0.7
        b.box(x, SEA_Y - 0.1, wz(r) + 0.5 + 0.06, 0.18 + rand() * 0.16, 0.14 + rand() * 0.18, 0.14, R.rock)
      }
    }
  // plateau cliff: a few stones pushing out of the south face
  for (let c = 16; c <= 26; c++) {
    if (tile(c, 8) !== '^' || tile(c, 9) === 'S') continue
    if (rand() < 0.55) b.box(wx(c) - 0.3 + rand() * 0.6, 0.12 + rand() * 0.18, wz(8) + 0.52, 0.2, 0.14, 0.08, R.rock)
  }
}

/* ------------------------------------------------------------------ trees & props */

function roundTree(b: Builder, x: number, y: number, z: number, s: number) {
  b.box(x, y, z, 0.16 * s, 0.34 * s, 0.16 * s, R.trunk, true)
  // a round canopy: narrow, wide, narrow, cap (reads as a ball after pixelation)
  b.box(x, y + 0.26 * s, z, 0.6 * s, 0.12 * s, 0.6 * s, R.tree, true)
  b.box(x, y + 0.36 * s, z, 0.9 * s, 0.32 * s, 0.9 * s, R.tree, true)
  b.box(x, y + 0.68 * s, z, 0.7 * s, 0.16 * s, 0.7 * s, R.tree, true)
  b.box(x, y + 0.84 * s, z, 0.4 * s, 0.1 * s, 0.4 * s, R.tree, true)
  // sunlit clump, top-left
  b.box(x - 0.13 * s, y + 0.84 * s, z - 0.04 * s, 0.3 * s, 0.13 * s, 0.3 * s, R.treeHi)
  b.box(x - 0.24 * s, y + 0.68 * s, z + 0.12 * s, 0.18 * s, 0.17 * s, 0.2 * s, R.treeHi)
}

function pineTree(b: Builder, x: number, y: number, z: number, s: number) {
  b.box(x, y, z, 0.14 * s, 0.22 * s, 0.14 * s, R.trunk, true)
  const tiers = [0.86, 0.7, 0.54, 0.38, 0.2]
  tiers.forEach((w, i) => b.box(x, y + (0.16 + i * 0.2) * s, z, w * s, 0.22 * s, w * s, R.conifer, true))
}

const _pm = new THREE.Matrix4()
const _pr = new THREE.Matrix4()
function palmTree(b: Builder, x: number, y: number, z: number, s: number, lean: number) {
  for (let i = 0; i < 5; i++) b.box(x + lean * i * i * 0.012 * s, y + i * 0.2 * s, z, 0.14 * s, 0.21 * s, 0.14 * s, R.trunk, true)
  const tx = x + lean * 0.2 * s
  const ty = y + 1.0 * s
  // drooping fronds: thin slabs rotated out and tipped down
  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2 + 0.3
    _pm.makeTranslation(tx, ty, z)
    _pm.multiply(_pr.makeRotationY(ang))
    _pm.multiply(_pr.makeRotationZ(-0.5))
    b.matrix = _pm
    b.box(0.28 * s, -0.04 * s, 0, 0.58 * s, 0.07 * s, 0.2 * s, R.canopy, true)
  }
  b.matrix = null
  b.box(tx, ty - 0.02 * s, z, 0.22 * s, 0.12 * s, 0.22 * s, R.canopy, true)
  b.box(tx + 0.06 * s, ty - 0.12 * s, z + 0.08 * s, 0.1 * s, 0.1 * s, 0.1 * s, R.trunk)
}

function bush(b: Builder, x: number, y: number, z: number) {
  b.box(x, y, z, 0.46, 0.22, 0.4, R.canopy, true)
  b.box(x - 0.05, y + 0.22, z, 0.28, 0.1, 0.24, R.canopy, true)
}

function flowers(b: Builder, x: number, y: number, z: number, rand: () => number) {
  const ramps = [R.flower, R.flowerY, R.flowerW]
  const ramp = ramps[Math.floor(rand() * ramps.length)]
  for (let i = 0; i < 3; i++) b.box(x + (rand() - 0.5) * 0.5, y, z + (rand() - 0.5) * 0.4, 0.09, 0.07, 0.09, ramp)
}

function tuft(b: Builder, x: number, y: number, z: number) {
  b.box(x - 0.05, y, z, 0.05, 0.1, 0.05, R.canopyDark)
  b.box(x + 0.04, y, z, 0.05, 0.07, 0.05, R.canopyDark)
}

function mountain(b: Builder, x: number, z: number, w: number, d: number, levels: number, snowFrom: number, rand: () => number) {
  const step = 0.44
  let ox = 0
  let oz = 0
  for (let k = 0; k < levels; k++) {
    const f = 1 - k / (levels + 0.4)
    const ramp = k >= snowFrom ? R.snow : k < 2 ? R.mountainLow : R.mountain
    // jagged tiers: each one shifted a little, so the silhouette isn't a ziggurat
    ox += (rand() - 0.5) * 0.3
    oz += (rand() - 0.5) * 0.16
    b.box(x + ox, k * step, z + oz, w * f * (0.9 + rand() * 0.2), step, d * f, ramp, true)
    // a rocky shoulder on the lower tiers
    if (k < levels - 2 && rand() < 0.7) {
      const side = rand() < 0.5 ? -1 : 1
      b.box(x + ox + side * w * f * 0.42, k * step, z + oz + 0.1, w * f * 0.3, step * 1.3, d * f * 0.5, k < 2 ? R.mountainLow : R.mountain, true)
    }
    // snow drips over the edge of the first snowy tier
    if (k === snowFrom) b.box(x + ox - w * f * 0.2, k * step - 0.14, z + oz + d * f * 0.5 - 0.04, w * f * 0.3, 0.14, 0.1, R.snow)
  }
}

function rock(b: Builder, x: number, y: number, z: number, s: number) {
  b.box(x, y, z, 0.36 * s, 0.22 * s, 0.3 * s, R.rock, true)
  b.box(x - 0.05 * s, y + 0.22 * s, z, 0.2 * s, 0.1 * s, 0.18 * s, R.rock, true)
}

/** Everything static on the island except the level buildings. */
export function buildIsland(b: Builder, mobile: boolean) {
  const rand = rng(1607)
  terrain(b, rand)
  const blocked = blockedTiles()

  // ---- mountains behind Listen (north-west), the river's spring at their foot
  const mr = rng(42)
  mountain(b, wx(3.2), wz(3.1), 3.4, 2.4, 5, 4, mr)
  mountain(b, wx(5.9), wz(2.6), 4.0, 2.6, 7, 5, mr)
  mountain(b, wx(8.3), wz(3.3), 2.6, 2.0, 4, 3, mr)
  mountain(b, wx(2.2), wz(5.0), 2.0, 1.4, 3, 9, mr)
  mountain(b, wx(4.9), wz(4.7), 1.8, 1.2, 2, 9, mr)
  // spring: a stone mouth where the river starts
  b.box(wx(10), 0, wz(2) + 0.1, 1.1, 0.5, 0.8, R.rock, true)
  b.box(wx(10), 0, wz(2) + 0.5, 0.5, 0.34, 0.12, R.dark)

  // ---- forests (clusters), then scatter
  const clusters: { c: number; r: number; rad: number; dens: number; kind: 'round' | 'pine' }[] = [
    { c: 2, r: 9.5, rad: 3.2, dens: 0.8, kind: 'round' },
    { c: 13.6, r: 6.5, rad: 2.4, dens: 0.75, kind: 'round' },
    { c: 25.5, r: 4, rad: 2.8, dens: 0.7, kind: 'pine' },
    { c: 27, r: 15, rad: 2.2, dens: 0.75, kind: 'round' },
    { c: 19, r: 16.5, rad: 2.6, dens: 0.6, kind: 'round' },
    { c: 9.6, r: 9.4, rad: 1.4, dens: 0.6, kind: 'round' },
    { c: 1.5, r: 13.5, rad: 1.6, dens: 0.5, kind: 'pine' },
    { c: 17, r: 7.5, rad: 1.2, dens: 0.5, kind: 'pine' },
  ]
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const t = tile(c, r)
      if (!isLand(t) || t === 'S') continue
      const kind = tileKind(c, r)
      const y = t === '^' ? PLATEAU_H : 0
      const x = wx(c)
      const z = wz(r)
      if (blocked.has(c, r)) {
        // next to the path: only ground detail, kept off the dotted line
        if (blocked.path(c, r) || kind === ',' || NODES.some(n => Math.abs(n.col - c) <= 1 && Math.abs(n.row - r) <= 1)) continue
        if (NODES.some(n => Math.abs(n.bcol - c) <= 2 && Math.abs(n.brow - r) <= 2)) continue
        if (c >= 16 && c <= 23 && r <= 6) continue
        if (c <= 9 && r <= 5) continue
        const g = rand()
        const ox = (rand() - 0.5) * 0.5
        if (g < 0.2) flowers(b, x + ox * 0.4, y, z + (rand() - 0.5) * 0.3, rand)
        else if (g < 0.55) tuft(b, x + ox, y, z + (rand() - 0.5) * 0.5)
        continue
      }
      let p = 0
      let k: 'round' | 'pine' = 'round'
      for (const cl of clusters) {
        const d = Math.hypot(c - cl.c, r - cl.r)
        const v = cl.dens * Math.max(0, 1 - (d / cl.rad) ** 2)
        if (v > p) {
          p = v
          k = cl.kind
        }
      }
      const roll = rand()
      const jx = (rand() - 0.5) * 0.44
      const jz = (rand() - 0.5) * 0.36
      if (kind === ',') {
        if (roll < 0.22) palmTree(b, x + jx, y, z + jz, 0.9 + rand() * 0.2, rand() < 0.5 ? -1 : 1)
        continue
      }
      if (roll < p && !(mobile && rand() < 0.3)) {
        if (k === 'pine') pineTree(b, x + jx, y, z + jz, 0.95 + rand() * 0.25)
        else if (rand() < 0.25) {
          // two saplings instead of one big tree: breaks the grid
          roundTree(b, x - 0.22, y, z - 0.18, 0.62 + rand() * 0.12)
          roundTree(b, x + 0.24, y, z + 0.2, 0.66 + rand() * 0.12)
        } else roundTree(b, x + jx, y, z + jz, 0.82 + rand() * 0.38)
      } else if (roll < p + 0.07) bush(b, x + jx, y, z + jz)
      else if (roll < p + 0.19) flowers(b, x, y, z, rand)
      else if (roll < p + 0.36) tuft(b, x + jx, y, z + jz)
      else if (roll < p + 0.39) rock(b, x + jx, y, z + jz, 0.8 + rand() * 0.3)
    }

  // ---- a picket fence along the plateau edge (gaps at the stairs)
  for (let c = 16; c <= 26; c++) {
    if (tile(c, 8) !== '^' || tile(c, 9) === 'S' || c === 19 || c === 23) continue
    const z = wz(8) + 0.4
    for (let i = 0; i < 2; i++) b.box(wx(c) - 0.25 + i * 0.5, PLATEAU_H, z, 0.08, 0.26, 0.08, R.plank)
    b.box(wx(c), PLATEAU_H + 0.16, z, 1, 0.06, 0.05, R.plank)
  }

  // ---- the bridge (planks + rails) where the path crosses the river
  {
    const x = wx(12)
    const z = wz(14)
    b.box(x, -0.02, z, 1.5, 0.12, 0.86, R.plank, true)
    for (let i = -2; i <= 2; i++) b.box(x + i * 0.3, 0.1, z, 0.04, 0.02, 0.84, R.wood)
    for (const s of [-1, 1]) {
      b.box(x, 0.28, z + s * 0.4, 1.5, 0.06, 0.06, R.wood, true)
      for (const px of [-0.7, 0, 0.7]) b.box(x + px, 0.1, z + s * 0.4, 0.08, 0.24, 0.08, R.wood, true)
    }
  }

  // ---- START: a little dock, a signpost
  {
    const x = wx(6)
    const z0 = wz(17) + 0.25
    for (let i = 0; i < 4; i++) b.box(x, -0.12, z0 + i * 0.4, 0.66, 0.1, 0.38, R.plank, true)
    for (const px of [-0.28, 0.28]) for (const k of [0.75, 1.35]) b.box(x + px, SEA_Y - 0.2, z0 + k, 0.1, 0.5, 0.1, R.wood, true)
    const sx = wx(START.col) - 0.8
    const sz = wz(START.row) - 0.3
    b.box(sx, 0, sz, 0.1, 0.62, 0.1, R.wood, true)
    b.box(sx, 0.42, sz + 0.05, 0.62, 0.26, 0.06, R.plank, true)
    b.box(sx - 0.12, 0.5, sz + 0.085, 0.3, 0.04, 0.01, R.wood)
    b.box(sx + 0.02, 0.58, sz + 0.085, 0.4, 0.04, 0.01, R.wood)
  }
}

/* ------------------------------------------------------------------ water */

/** distance (tiles) from each texel to the nearest land tile, as an R8 texture */
function distanceField() {
  const X0 = -26
  const Z0 = -20
  const W = 52
  const H = 40
  const RES = 4
  const w = W * RES
  const h = H * RES
  const data = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    const z = Z0 + (j + 0.5) / RES
    for (let i = 0; i < w; i++) {
      const x = X0 + (i + 0.5) / RES
      const c0 = Math.round(x + (COLS - 1) / 2)
      const r0 = Math.round(z + (ROWS - 1) / 2)
      let best = 4
      for (let dr = -4; dr <= 4; dr++)
        for (let dc = -4; dc <= 4; dc++) {
          const c = c0 + dc
          const r = r0 + dr
          if (!isLand(tile(c, r))) continue
          const dx = Math.max(Math.abs(x - wx(c)) - 0.5, 0)
          const dz = Math.max(Math.abs(z - wz(r)) - 0.5, 0)
          const d = Math.hypot(dx, dz)
          if (d < best) best = d
        }
      data[j * w + i] = Math.round((best / 4) * 255)
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return { tex, bounds: new THREE.Vector4(X0, Z0, 1 / W, 1 / H) }
}

export function makeWater() {
  const { tex, bounds } = distanceField()
  const uniforms = {
    uDist: { value: tex },
    uBounds: { value: bounds },
    uTime: { value: 0 },
    uRiver: { value: 0 },
    uDeep: { value: new THREE.Color(P.blue) },
    uShallow: { value: new THREE.Color(P.cyan) },
    uFoam: { value: new THREE.Color(P.white) },
    uGlint: { value: new THREE.Color(P.cyan) },
  }
  const vert = /* glsl */ `
    varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `
  const frag = /* glsl */ `
    uniform sampler2D uDist;
    uniform vec4 uBounds;
    uniform float uTime, uRiver;
    uniform vec3 uDeep, uShallow, uFoam, uGlint;
    varying vec3 vW;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 uv = (vW.xz - uBounds.xy) * uBounds.zw;
      float d = 4.0;
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) d = texture2D(uDist, uv).r * 4.0;
      // animation runs on steps, like tile animation on a console
      float st = floor(uTime * 2.5);
      float breathe = mod(st, 2.0);
      vec3 c = uDeep;
      if (d < 1.05) c = uShallow;
      if (d < 0.12 + 0.08 * breathe) c = uFoam;
      // a broken second foam line out in the shallows (sea only)
      float ring = abs(d - (0.6 + 0.08 * breathe));
      float brk = hash(floor(vW.xz * 2.0) + 3.0);
      if (uRiver < 0.5 && ring < 0.05 && brk > 0.45) c = uFoam;
      // glints drifting over open water
      vec2 g = vW.xz * vec2(0.7, 1.4);
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float h = hash(cell + 17.0);
      float ph = fract(h * 5.0 + st * 0.11);
      float dash = step(0.22, f.x) * step(f.x, 0.78) * step(0.4, f.y) * step(f.y, 0.62);
      if (uRiver < 0.5 && d > 1.5 && h > 0.8 && ph < 0.34) c = mix(c, uGlint * 1.0 + vec3(0.0), dash);
      if (uRiver < 0.5 && d > 1.5 && h > 0.965 && ph < 0.2) c = mix(c, uFoam, dash);
      // river: white dashes stepping downstream
      if (uRiver > 0.5) {
        vec2 q = vec2(vW.x * 2.2, vW.z * 1.6 - st * 0.4);
        vec2 fq = fract(q);
        float hq = hash(floor(q) + 9.0);
        float dq = step(0.3, fq.x) * step(fq.x, 0.7) * step(0.2, fq.y) * step(fq.y, 0.55);
        if (d > 0.16 && hq > 0.72) c = mix(c, uFoam, dq);
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag }),
  )
  sea.rotation.x = -Math.PI / 2
  sea.position.y = SEA_Y

  // river surface: merged quads over the river tiles, same shader, flowing
  const riverU = { ...uniforms, uRiver: { value: 1 } }
  const quads: THREE.BufferGeometry[] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isRiver(MAP[r][c])) continue
      const q = new THREE.PlaneGeometry(1, 1)
      q.rotateX(-Math.PI / 2)
      q.translate(wx(c), RIVER_Y, wz(r))
      quads.push(q)
    }
  // the river mouth spills over the lip into the sea
  const fall = new THREE.PlaneGeometry(1, RIVER_Y - SEA_Y)
  fall.translate(wx(12), (RIVER_Y + SEA_Y) / 2, wz(15) + 0.5)
  const riverGeo = mergeQuads(quads)
  quads.forEach(q => q.dispose())
  const river = new THREE.Mesh(riverGeo, new THREE.ShaderMaterial({ uniforms: riverU, vertexShader: vert, fragmentShader: frag }))
  const fallMesh = new THREE.Mesh(
    fall,
    new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uA: { value: new THREE.Color(P.cyan) }, uB: { value: new THREE.Color(P.white) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uA, uB; varying vec2 vUv;
        void main(){
          float st = floor(uTime * 6.0);
          float band = step(0.5, fract(vUv.y * 3.0 + st * 0.25 + floor(vUv.x * 4.0) * 0.37));
          gl_FragColor = vec4(mix(uA, uB, band), 1.0);
        }`,
    }),
  )
  return {
    group: new THREE.Group().add(sea, river, fallMesh),
    tick(t: number) {
      uniforms.uTime.value = t
    },
  }
}

function mergeQuads(list: THREE.BufferGeometry[]) {
  const pos: number[] = []
  const idx: number[] = []
  for (const g of list) {
    const base = pos.length / 3
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i))
    const ix = g.getIndex()!
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i))
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setIndex(idx)
  out.computeBoundingSphere()
  return out
}
