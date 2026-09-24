import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * The shared "cabinet" for Hark Arcade: a camera-centred backdrop gradient
 * (with optional twinkling pixel stars) plus simple game lighting — one key
 * light and a hemisphere fill, no shadows (pixel art is shaded with toon
 * steps, see src/kit/materials.ts).
 *
 * Chapters set world.params every frame they care; the engine resets them to
 * defaults first; colours are damped so cuts never pop (the iris wipe hides
 * the rest).
 */

export interface WorldParams {
  /** backdrop gradient, top and bottom (hex strings or THREE.Color-able) */
  top: THREE.ColorRepresentation
  bottom: THREE.ColorRepresentation
  /** 0..1 twinkling pixel stars in the upper backdrop */
  stars: number
  /** key light direction (from) and strength */
  keyDir: THREE.Vector3
  key: number
  /** hemisphere fill strength */
  fill: number
}

export const WORLD_DEFAULTS = { top: '#1b1f3b', bottom: '#5a3a9a', stars: 0.6, key: 2.2, fill: 1.0 }

export class World {
  object = new THREE.Group()
  key: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams = { ...WORLD_DEFAULTS, keyDir: new THREE.Vector3(-0.5, 0.8, 0.6) }
  private cur = { top: new THREE.Color(), bottom: new THREE.Color(), stars: 0.6, key: 2.2, fill: 1 }
  private first = true
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uStars: { value: 0.6 },
    uTime: { value: 0 },
  }
  private tmpA = new THREE.Color()
  private tmpB = new THREE.Color()

  constructor(scene: THREE.Scene, _mobile: boolean) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uBottom;
          uniform float uStars, uTime;
          varying vec3 vDir;
          float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y * 0.5 + 0.5;
            vec3 c = mix(uBottom, uTop, smoothstep(0.25, 0.85, h));
            // chunky star field on a lat/long grid (the CRT pass pixelates it anyway)
            vec2 g = vec2(atan(d.z, d.x) * 170.0, asin(clamp(d.y, -1.0, 1.0)) * 170.0);
            vec2 cell = floor(g);
            float r = hash(cell);
            float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
            float star = step(0.993, r) * smoothstep(0.45, 0.85, h) * tw;
            c = mix(c, vec3(1.0), clamp(star * uStars, 0.0, 1.0));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    )
    dome.frustumCulled = false
    dome.renderOrder = -10
    this.object.add(dome)

    this.key = new THREE.DirectionalLight(0xffffff, 2.2)
    scene.add(this.key)
    scene.add(this.key.target)
    this.hemi = new THREE.HemisphereLight(0xcfd8ff, 0x2c2f6b, 1.0)
    scene.add(this.hemi)
  }

  resetParams() {
    const p = this.params
    p.top = WORLD_DEFAULTS.top
    p.bottom = WORLD_DEFAULTS.bottom
    p.stars = WORLD_DEFAULTS.stars
    p.key = WORLD_DEFAULTS.key
    p.fill = WORLD_DEFAULTS.fill
    p.keyDir.set(-0.5, 0.8, 0.6)
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    this.tmpA.set(p.top)
    this.tmpB.set(p.bottom)
    if (this.first) {
      c.top.copy(this.tmpA)
      c.bottom.copy(this.tmpB)
      c.stars = p.stars
      c.key = p.key
      c.fill = p.fill
      this.first = false
    }
    const k = 1 - Math.exp(-5 * frame.dt)
    c.top.lerp(this.tmpA, k)
    c.bottom.lerp(this.tmpB, k)
    c.stars += (p.stars - c.stars) * k
    c.key += (p.key - c.key) * k
    c.fill += (p.fill - c.fill) * k
    const u = this.uniforms
    u.uTop.value.copy(c.top)
    u.uBottom.value.copy(c.bottom)
    u.uStars.value = c.stars
    u.uTime.value = frame.time
    this.key.intensity = c.key
    this.key.position.copy(camera.position).addScaledVector(p.keyDir.clone().normalize(), 50)
    this.key.target.position.copy(camera.position)
    this.key.target.updateMatrixWorld()
    this.hemi.intensity = c.fill
    this.object.position.copy(camera.position)
  }
}
