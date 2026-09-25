import * as THREE from 'three'

/*
 * A cabinet's CRT. Shows its attract-mode title card until the player walks
 * up; then it BOOTS: the attract picture collapses to a bright line, the line
 * opens into the website screenshot with a white flash, and a rolling sync bar
 * settles it. uBoot (0..1) is stepped on the CPU so the whole thing animates
 * on game frames. uStatic adds a burst of snow (channel switch on the
 * multi-game machine).
 *
 * Colours stay <= ~0.95 so the bloom pass (threshold ~1) leaves the site
 * itself crisp; the post pass palette-snaps it with everything else.
 */

export interface ScreenUniforms {
  [k: string]: THREE.IUniform
  uShot: THREE.IUniform<THREE.Texture | null>
  uHasShot: THREE.IUniform<number>
  uFlip: THREE.IUniform<number>
  uAttract: THREE.IUniform<THREE.Texture | null>
  uCell: THREE.IUniform<THREE.Vector4>
  uBoot: THREE.IUniform<number>
  uStatic: THREE.IUniform<number>
  uBright: THREE.IUniform<number>
  uTime: THREE.IUniform<number>
  uSeed: THREE.IUniform<number>
  uBlink: THREE.IUniform<number>
}

export function screenMaterial(attract: THREE.Texture, cell: THREE.Vector4, seed: number) {
  const uniforms: ScreenUniforms = {
    uShot: { value: null },
    uHasShot: { value: 0 },
    uFlip: { value: 0 },
    uAttract: { value: attract },
    uCell: { value: cell },
    uBoot: { value: 0 },
    uStatic: { value: 0 },
    uBright: { value: 0.8 },
    uTime: { value: 0 },
    uSeed: { value: seed },
    uBlink: { value: 1 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uShot, uAttract;
      uniform vec4 uCell;
      uniform float uHasShot, uFlip, uBoot, uStatic, uBright, uTime, uSeed, uBlink;
      varying vec2 vUv;
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec2 uv = vUv;
        // both pictures are sampled up front (uniform control flow for derivatives)
        vec3 att = texture2D(uAttract, uCell.xy + uv * uCell.zw).rgb;
        float blink = step(0.5, fract(uTime * 0.8 + uSeed * 0.37));
        float band = step(0.06, uv.y) * step(uv.y, 0.21);
        att *= 1.0 - band * blink * uBlink;
        vec2 suv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFlip));
        vec3 shot = texture2D(uShot, suv).rgb;
        // no screenshot yet: a slow blue test pattern
        vec3 wait = vec3(0.02, 0.03, 0.09) + vec3(0.0, 0.05, 0.12) * step(0.5, fract(uv.y * 12.0 - uTime * 0.5));
        shot = mix(wait, shot, uHasShot);

        float snow = hash(floor(uv * vec2(96.0, 60.0)) + floor(uTime * 15.0) * 1.7 + uSeed);
        float b = clamp(uBoot, 0.0, 1.0);
        vec3 col;
        if (b < 0.3) {
          // attract picture squeezes to a bright line
          float k = b / 0.3;
          float halfH = mix(0.5, 0.006, smoothstep(0.25, 1.0, k));
          float inBand = step(abs(uv.y - 0.5), halfH);
          col = mix(att, vec3(0.95), k * k) * inBand;
          col = mix(col, vec3(snow), 0.35 * k * inBand);
        } else if (b < 0.62) {
          // the line opens onto the site with a flash
          float k = (b - 0.3) / 0.32;
          float halfH = mix(0.006, 0.5, k * k);
          float inBand = step(abs(uv.y - 0.5), halfH);
          col = mix(vec3(0.95), shot, smoothstep(0.15, 0.95, k)) * inBand;
        } else {
          // settle: a rolling sync bar and a little snow
          float k = (b - 0.62) / 0.38;
          float y = 1.15 - k * 1.3;
          float bar = 1.0 - smoothstep(0.0, 0.07, abs(uv.y - y));
          col = shot * (1.0 + 0.3 * bar * (1.0 - k));
          col = mix(col, vec3(snow), 0.18 * (1.0 - k));
        }
        col = mix(col, vec3(snow * 0.8), clamp(uStatic, 0.0, 1.0));
        // glass: darker corners
        vec2 e = abs(uv - 0.5) * 2.0;
        float edge = max(e.x, e.y);
        col *= 1.0 - 0.35 * smoothstep(0.82, 1.0, edge);
        gl_FragColor = vec4(col * uBright, 1.0);
      }
    `,
  })
  return { mat, uniforms }
}
