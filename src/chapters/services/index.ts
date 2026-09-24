import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { logoGeometry } from '../../logo/logo'
import { toon, glow, P } from '../../kit/pixel'

// PLACEHOLDER — replaced by the services chapter build.
export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = new THREE.Mesh(logoGeometry({ depth: 0.25 }), toon(P.signal))
  mark.scale.setScalar(2.4)
  group.add(mark)
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), glow(P.gold, 2))
  diamond.position.z = 0.3
  group.add(diamond)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 20, 20), new THREE.MeshBasicMaterial({ color: P.magenta, wireframe: true }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1.8
  group.add(floor)
  let title: HTMLElement
  return {
    id: 'services',
    group,
    init(ctx) {
      el('p', 'hud-eyebrow', 'Power-Ups', ctx.stage).style.cssText = 'position:absolute;left:var(--gutter);top:var(--safe-top)'
      title = rise(el('h2', 'hud-h2', undefined, ctx.stage), 'Eleven ways to be <em>heard.</em>')
      title.style.cssText = 'position:absolute;left:var(--gutter);top:calc(var(--safe-top) + 34px);max-width:60vw'
    },
    update(local, frame, ctx) {
      ctx.world.params.top = '#1b1f3b'
      ctx.world.params.bottom = '#0e6b52'
      mark.rotation.y = local * 6 + frame.time * 0.5
      floor.position.z = (frame.time * 2) % 2
      setRise(title, local > 0.05 && local < 0.95)
    },
    camera(_local, _frame, out) {
      out.position.set(0, 0.8, 8)
      out.target.set(0, 0, 0)
      out.fov = 40
      out.parallax = 0.4
    },
  }
}
