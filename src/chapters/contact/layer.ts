import * as THREE from 'three'

/*
 * A screen-space "framebuffer" at the CRT's game resolution: a canvas with
 * one texel per game pixel, shown as a clip-space quad that lines up exactly
 * with the post pass's pixel grid (cells are counted from the bottom-left of
 * the frame, `px` CSS px each). Anything drawn here at integer coordinates is
 * a single, crisp game pixel after pixelation + palette snap — real ROM-font
 * text and 2D sprite effects composited with the toon-shaded 3D.
 *
 * Coordinates are canvas game px from the top-left of the canvas; the canvas
 * may overhang the top of the screen by a fraction of a game pixel (`off`
 * CSS px), see cssX/cssY.
 */
export class PixelLayer {
  canvas = document.createElement('canvas')
  ctx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial
  /** canvas size in game px */
  gw = 1
  gh = 1
  px = 3
  W = 1
  H = 1
  /** CSS px the canvas overhangs the top of the screen */
  off = 0
  /** a redraw signature; draw only when it changes (NaN: always redraw) */
  key = NaN

  private ctxOpts: CanvasRenderingContext2DSettings

  constructor(opts: { gain?: number; renderOrder: number; readback?: boolean }) {
    this.canvas.width = 1
    this.canvas.height = 1
    // small canvases that are read back (dither fades) stay on the CPU
    this.ctxOpts = { willReadFrequently: !!opts.readback }
    this.ctx = this.canvas.getContext('2d', this.ctxOpts)!
    this.tex = this.makeTex()
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.tex },
        uRect: { value: new THREE.Vector4(-1, -1, 1, 1) },
        uGain: { value: opts.gain ?? 1 },
      },
      vertexShader: /* glsl */ `
        uniform vec4 uRect;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(mix(uRect.xy, uRect.zw, uv), 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uGain;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uMap, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb * uGain, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = opts.renderOrder
  }

  private makeTex() {
    const t = new THREE.CanvasTexture(this.canvas)
    t.magFilter = t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

  /** Match the viewport (CSS px) and game-pixel size. Returns true when it changed. */
  resize(W: number, H: number, px: number) {
    const gw = Math.max(1, Math.ceil(W / px - 1e-4))
    const gh = Math.max(1, Math.ceil(H / px - 1e-4))
    if (gw === this.gw && gh === this.gh && W === this.W && H === this.H && px === this.px) return false
    this.W = W
    this.H = H
    this.px = px
    this.off = gh * px - H
    if (gw !== this.gw || gh !== this.gh) {
      this.gw = gw
      this.gh = gh
      this.canvas.width = gw
      this.canvas.height = gh
      this.ctx = this.canvas.getContext('2d', this.ctxOpts)!
      this.tex.dispose()
      this.tex = this.makeTex()
      this.mat.uniforms.uMap.value = this.tex
    }
    this.ctx.imageSmoothingEnabled = false
    this.key = NaN
    return true
  }

  /** Place the quad; `sx`, `sy` = screen shake in whole game px (y down). */
  place(sx = 0, sy = 0) {
    const r = this.mat.uniforms.uRect.value as THREE.Vector4
    const dx = (2 * sx * this.px) / this.W
    const dy = (-2 * sy * this.px) / this.H
    r.set(-1 + dx, -1 + dy, -1 + (2 * this.gw * this.px) / this.W + dx, -1 + (2 * this.gh * this.px) / this.H + dy)
  }

  /** game px (canvas coords) -> CSS px from the viewport's top-left */
  cssX(gx: number) {
    return gx * this.px
  }
  cssY(gy: number) {
    return gy * this.px - this.off
  }
  /** CSS px -> canvas game px (fractional) */
  gx(cssX: number) {
    return cssX / this.px
  }
  gy(cssY: number) {
    return (cssY + this.off) / this.px
  }

  begin() {
    this.ctx.clearRect(0, 0, this.gw, this.gh)
  }

  commit() {
    this.tex.needsUpdate = true
  }

  set visible(v: boolean) {
    this.mesh.visible = v
  }
}
