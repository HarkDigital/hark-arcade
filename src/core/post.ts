import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

/**
 * Final display-space pass for Hark Arcade — the CRT:
 *  - PIXELATE: the frame is resampled on a coarse grid (uPixel CSS px per
 *    game pixel; 4-tap average per cell so edges don't crawl).
 *  - PALETTE: every game pixel is snapped to the Hark-16 palette with a 4x4
 *    Bayer ordered dither (uDither), in display space.
 *  - CRT: scanlines, an RGB aperture mask, barrel curvature, soft vignette,
 *    a touch of phosphor bloom (bloom pass runs before this).
 *  - IRIS WIPE at chapter cuts: a pixel-stepped circle closes to black at the
 *    boundary and opens on the next level (classic game transition).
 *  - glitch = VHS tracking wobble; flash = white flash (hits, power-ups).
 */
export const PALETTE_HEX = [
  '#0b0d14', // 0 void
  '#1b1f3b', // 1 night
  '#2c2f6b', // 2 indigo
  '#5a3a9a', // 3 purple
  '#c2419a', // 4 magenta
  '#ff5a6e', // 5 coral
  '#ff9b3d', // 6 orange
  '#ffd84a', // 7 gold
  '#fff4d8', // 8 cream
  '#ffffff', // 9 white
  '#9aa3c7', // 10 steel
  '#4e557e', // 11 slate
  '#00ff85', // 12 signal (Hark green)
  '#00b862', // 13 green
  '#0e6b52', // 14 pine
  '#2fd4e0', // 15 cyan
  '#3a7bff', // 16 blue
  '#8b5a3c', // 17 brown
]

const PALETTE_GLSL = PALETTE_HEX.map(h => {
  const c = parseInt(h.slice(1), 16)
  return `vec3(${(((c >> 16) & 255) / 255).toFixed(4)}, ${(((c >> 8) & 255) / 255).toFixed(4)}, ${((c & 255) / 255).toFixed(4)})`
})

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    /** 0..1, peaks at a chapter cut (engine-driven) */
    uTransition: { value: 0 },
    uGlitch: { value: 0 },
    uAberration: { value: 0.0015 },
    uGrain: { value: 0.02 },
    uVignette: { value: 0.35 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    /** CSS px per game pixel */
    uPixel: { value: 4 },
    /** 0 = no palette snap, 1 = full Hark-16 */
    uPalette: { value: 1 },
    /** ordered-dither strength */
    uDither: { value: 0.55 },
    /** scanline + aperture mask strength */
    uCrt: { value: 0.55 },
    /** barrel curvature */
    uCurve: { value: 0.035 },
    /** iris centre in UV */
    uIris: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDpr, uTransition, uGlitch, uAberration, uGrain, uVignette, uFlash, uFade, uPixel, uPalette, uDither, uCrt, uCurve;
    uniform vec2 uResolution, uIris;
    varying vec2 vUv;

    const int NPAL = ${PALETTE_HEX.length};
    vec3 pal(int i) {
      ${PALETTE_GLSL.map((c, i) => `if (i == ${i}) return ${c};`).join('\n      ')}
      return vec3(0.0);
    }
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float bayer4(vec2 p) {
      vec2 q = mod(floor(p), 4.0);
      float x = q.x, y = q.y;
      // 4x4 Bayer matrix, normalised to [-0.5, 0.5)
      float m = mod(x, 2.0) * 2.0 + mod(y, 2.0) * 3.0 - mod(x, 2.0) * mod(y, 2.0) * 4.0;
      float n = mod(floor(x * 0.5), 2.0) * 2.0 + mod(floor(y * 0.5), 2.0) * 3.0 - mod(floor(x * 0.5), 2.0) * mod(floor(y * 0.5), 2.0) * 4.0;
      return (m * 4.0 + n) / 16.0 - 0.46875;
    }
    vec3 snapPalette(vec3 c) {
      // nearest palette colour, weighting green (luma-ish) distance higher
      vec3 best = pal(0);
      float bd = 1e9;
      for (int i = 0; i < NPAL; i++) {
        vec3 p = pal(i);
        vec3 d = (c - p) * vec3(0.9, 1.25, 0.75);
        float dd = dot(d, d);
        if (dd < bd) { bd = dd; best = p; }
      }
      return best;
    }

    void main() {
      // barrel curvature
      vec2 cc = vUv - 0.5;
      float r2 = dot(cc, cc);
      vec2 uv = 0.5 + cc * (1.0 + uCurve * r2 * 4.0);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.02, 0.02, 0.03, 1.0); return; }

      // VHS tracking wobble
      float g = clamp(uGlitch, 0.0, 1.0);
      uv.x += g * (0.004 * sin(uv.y * 90.0 + uTime * 30.0) + 0.012 * step(0.985, hash(vec2(floor(uv.y * 60.0), floor(uTime * 12.0)))));

      // pixel grid
      vec2 cssRes = uResolution / uDpr;
      float px = max(1.0, uPixel);
      vec2 grid = cssRes / px;
      vec2 cell = floor(uv * grid);
      vec2 cuv = (cell + 0.5) / grid;
      vec2 off = 0.25 / grid;
      vec3 col = 0.25 * (texture2D(tDiffuse, cuv + vec2(-off.x, -off.y)).rgb + texture2D(tDiffuse, cuv + vec2(off.x, -off.y)).rgb
                       + texture2D(tDiffuse, cuv + vec2(-off.x, off.y)).rgb + texture2D(tDiffuse, cuv + vec2(off.x, off.y)).rgb);
      // a little chroma split on the red/blue guns
      col.r = mix(col.r, texture2D(tDiffuse, cuv + cc * uAberration).r, 0.5);
      col.b = mix(col.b, texture2D(tDiffuse, cuv - cc * uAberration).b, 0.5);

      // palette + ordered dither
      vec3 dithered = col + bayer4(cell) * uDither * 0.22;
      col = mix(col, snapPalette(clamp(dithered, 0.0, 1.0)), uPalette);

      col += vec3(1.0) * clamp(uFlash, 0.0, 1.0);

      // CRT: scanlines within each game pixel row + RGB aperture mask
      vec2 fragCss = gl_FragCoord.xy / uDpr;
      float within = fract(uv.y * grid.y);
      float scan = 0.72 + 0.28 * smoothstep(0.0, 0.35, within) * smoothstep(1.0, 0.65, within);
      float m = mod(floor(fragCss.x), 3.0);
      vec3 mask = m < 1.0 ? vec3(1.0, 0.78, 0.78) : m < 2.0 ? vec3(0.78, 1.0, 0.78) : vec3(0.78, 0.78, 1.0);
      col *= mix(vec3(1.0), scan * mask * 1.12, uCrt);

      // vignette + grain
      float v = 1.0 - smoothstep(0.35, 0.95, length(cc * vec2(1.0, 1.1)) * 1.35);
      col *= mix(1.0, 0.45 + 0.55 * v, uVignette);
      col += (hash(fragCss + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;

      // iris wipe: pixel-stepped circle closes to black at the cut
      float t = clamp(uTransition, 0.0, 1.0);
      if (t > 0.001) {
        vec2 ip = (cell + 0.5) / grid - uIris;
        ip.x *= cssRes.x / cssRes.y;
        float maxR = length(vec2(cssRes.x / cssRes.y, 1.0)) * 0.6;
        float rad = maxR * (1.0 - t);
        col *= step(length(ip), rad);
      }

      col = mix(col, vec3(0.0), clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** VHS tracking wobble 0..1 */
  glitch: number
  /** white flash 0..1 */
  flash: number
  exposure: number
  /** CSS px per game pixel (3 = fine 16-bit, 6 = chunky 8-bit) */
  pixel: number
  /** 0..1 palette snap */
  palette: number
  /** 0..1 ordered dither */
  dither: number
  /** 0..1 scanlines + aperture mask */
  crt: number
  /** barrel curvature */
  curve: number
  /** iris-wipe centre in UV (0.5, 0.5 = screen centre); set it to close the iris on a character */
  irisX: number
  irisY: number
}

/** Arcade defaults: glowing brights bloom like phosphor. */
export const POST_DEFAULTS: PostParams = {
  // bloom only on true glows: at 0.72 big green/gold fills bloomed and the palette snap turned them cream
  bloomStrength: 0.5,
  bloomRadius: 0.3,
  bloomThreshold: 0.88,
  aberration: 0.0015,
  grain: 0.02,
  vignette: 0.35,
  glitch: 0,
  flash: 0,
  exposure: 1,
  pixel: 4,
  palette: 1,
  dither: 0.55,
  crt: 0.55,
  curve: 0.035,
  irisX: 0.5,
  irisY: 0.5,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through the bloom
 * mip chain and black it out.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  /**
   * Chapters write targets here every frame (engine resets them to defaults
   * first); values are damped toward so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  fade = 0

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled, and MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: noMsaa ? 0 : 4,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new ShaderPass(SanitizeShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 0.72)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.final = new ShaderPass(FinalShader)
    this.composer.addPass(this.final)
  }

  /** kept for engine compatibility: cuts are an iris to black here */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  /**
   * Compile every post-processing shader in parallel (KHR_parallel_shader_compile)
   * so the first composer render doesn't block on ~16 synchronous links.
   */
  compileAsync(): Promise<unknown> {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const b = this.bloom as unknown as Record<string, unknown>
    const mats: THREE.Material[] = []
    const add = (m: unknown) => {
      if (m && (m as THREE.Material).isMaterial) mats.push(m as THREE.Material)
    }
    for (const pass of this.composer.passes) add((pass as unknown as { material?: unknown }).material)
    for (const m of (b.separableBlurMaterials as unknown[]) ?? []) add(m)
    add(b.compositeMaterial)
    add(b.blendMaterial)
    add(b.materialHighPassFilter)
    add(b.copyMaterial)
    const jobs = mats.map(m => {
      const mesh = new THREE.Mesh(quad.geometry, m)
      return this.renderer.compileAsync(mesh, cam).catch(() => {})
    })
    return Promise.all(jobs)
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
    this.final.uniforms.uDpr.value = dpr
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' || key === 'irisX' || key === 'irisY' ? p[key] : c[key] + (p[key] - c[key]) * k
    }
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    u.uVignette.value = c.vignette
    u.uFlash.value = c.flash
    u.uFade.value = this.fade
    // on phones keep game pixels a little finer so text-sized details survive
    u.uPixel.value = c.pixel
    u.uPalette.value = c.palette
    u.uDither.value = c.dither
    u.uCrt.value = c.crt
    u.uCurve.value = c.curve
    ;(u.uIris.value as THREE.Vector2).set(c.irisX, c.irisY)
    this.composer.render(dt)
  }
}
