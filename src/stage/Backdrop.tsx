import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { easing } from 'maath'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector2, Vector3 } from 'three'
import type { BackdropTheme } from '../data/sections'
import { useStage } from './focusStore'
import { RIPPLE_COUNT, RIPPLE_LIFE } from './gestures'
import { interaction, interactionTime } from './interaction'
import { ORDER } from './materials'

/**
 * The space behind the brain: a deep wash that lifts slightly behind the brain, and a field
 * of tiny dots drifting toward the viewer at many depths, so the background reads as deep.
 *
 * Every colour here passes through the ACES tone-mapping pass, which crushes dark values hard.
 * The hex values below are what it takes to come out the other side as rich blue or purple/lavender.
 */
export const BACKDROP_PALETTES: Record<BackdropTheme, { inner: string; outer: string }> = {
  blue: {
    /** Renders as #10255a, right behind the brain. */
    inner: '#26355f',
    /** Renders as #081430, toward the edges, before the vignette darkens the corners. */
    outer: '#1b2640',
  },
  purple: {
    /** Deep lavender glow right behind the brain. */
    inner: '#432c68',
    /** Deep plum-violet toward the edges. */
    outer: '#271a42',
  },
}

export const BACKDROP = BACKDROP_PALETTES.blue

/** Seconds for the backdrop wash to crossfade when switching between blue and purple sections. */
const BACKDROP_SETTLE = 0.85

/** Where the dots live, in world units. The brain spans about ±2.3 as it turns. */
const DUST = {
  count: 3400,
  /** Dots appear here, deep behind the brain, inside the camera's far plane. */
  far: -46,
  /** And have faded out by here, just before they would reach the brain. */
  near: -4.5,
  /** Spread to cover the view at the far end, wider on the left where the text column is. */
  x: [-36, 24],
  y: [-15, 15],
}

/** How the background answers the cursor. Distances are in screen heights. */
const CURSOR = {
  /** Seconds for the gap in the dots to catch up with the cursor. */
  follow: 0.12,
  /** Seconds for an effect to fade in or out, as the cursor comes and goes or the section changes. */
  fade: 0.45,
}

/**
 * Rings spreading from where the cursor has been. Shared by the wash, which shows them in the
 * background colour, and the dots, which they carry outward. Each ripple is x, y, age in seconds;
 * positions are in screen heights from the centre, so rings stay round on any screen shape.
 */
const rippleChunk = /* glsl */ `
  uniform vec3 uRipples[${RIPPLE_COUNT}];

  // Height of one ring at distance d from its centre: a crest with a shallow trough either side.
  float rippleRing(float d, float age) {
    if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(2)}) return 0.0;
    float x = (d - age * 0.34) / 0.05;
    float life = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.35, ${RIPPLE_LIFE.toFixed(2)}, age));
    return cos(x * 2.4) * exp(-x * x) * life;
  }
`

const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const backdropFragment = /* glsl */ `
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform vec2 uFocus;
  uniform float uAspect;
  uniform float uRipple;
  varying vec2 vUv;
  ${rippleChunk}
  void main() {
    float r = length((vUv - uFocus) * vec2(uAspect, 1.0));
    vec3 color = mix(uInner, uOuter, smoothstep(0.0, 1.3, r));

    // Ripples lift the colour on each crest and deepen it in each trough.
    if (uRipple > 0.001) {
      vec2 p = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
      float height = 0.0;
      for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
        height += rippleRing(distance(p, uRipples[i].xy), uRipples[i].z);
      }
      color *= 1.0 + clamp(height, -1.0, 1.6) * uRipple * 0.55;
    }
    gl_FragColor = vec4(color, 1.0);
  }
`

const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uNear;
  uniform float uFar;
  attribute vec4 aMotion; // start along the path, speed in trips per second, size, brightness
  attribute vec3 aWander; // drift distance, drift rate, phase
  uniform float uAspect;
  uniform vec2 uPointer; // in screen heights from the centre
  uniform float uPart;
  uniform float uRipple;
  varying float vAlpha;
  ${rippleChunk}

  void main() {
    float trip = fract(aMotion.x + uTime * aMotion.y);
    vec3 p = vec3(position.xy, mix(uFar, uNear, trip));

    // A lazy, never-repeating-looking float around the straight path.
    float t = uTime * aWander.y + aWander.z;
    p.x += aWander.x * (sin(t) + 0.5 * sin(t * 2.3 + 1.7));
    p.y += aWander.x * (cos(t * 0.8 + 0.4) + 0.5 * sin(t * 1.9 + 2.9));
    p.z += aWander.x * 0.8 * sin(t * 0.6 + 5.1);

    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;

    float size = aMotion.z * 40.0 * uPixelRatio / max(-view.z, 0.001);
    float fade = smoothstep(0.0, 0.15, trip) * (1.0 - smoothstep(0.86, 1.0, trip));
    float twinkle = 0.8 + 0.2 * sin(uTime * (0.7 + aWander.y * 4.0) + aWander.z * 7.0);
    vAlpha = aMotion.w * fade * twinkle;

    // A sprite under about 1.5 px flickers as it moves, so hold that size and dim it instead.
    float smallest = 1.5 * uPixelRatio;
    vAlpha *= min(1.0, (size / smallest) * (size / smallest));
    gl_PointSize = max(size, smallest);

    // The cursor effects move each dot across the screen, whatever its depth.
    vec2 s = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);

    // Part: dots near the cursor step aside, leaving a clear pool around it.
    vec2 away = s - uPointer;
    float d = length(away);
    s += away / max(d, 0.0001) * uPart * 0.17 * exp(-(d * d) / 0.07);

    // Ripple: each ring carries the dots it passes outward and brightens them on its crest.
    if (uRipple > 0.001) {
      float crest = 0.0;
      for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
        vec2 from = s - uRipples[i].xy;
        float reach = length(from);
        float height = rippleRing(reach, uRipples[i].z);
        s += from / max(reach, 0.0001) * height * uRipple * 0.035;
        crest += height;
      }
      vAlpha *= 1.0 + clamp(crest, -0.6, 1.5) * uRipple;
    }

    gl_Position.xy = s / vec2(uAspect, 1.0) * gl_Position.w;
  }
`

const dustFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float edge = 1.0 - smoothstep(0.12, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vec3(1.0), edge * vAlpha);
  }
`

function createDust() {
  const { count } = DUST
  const position = new Float32Array(count * 3)
  const motion = new Float32Array(count * 4)
  const wander = new Float32Array(count * 3)
  const between = (min: number, max: number) => min + Math.random() * (max - min)

  for (let i = 0; i < count; i++) {
    // A box this wide is mostly out of view up close, so a third of the dots keep to a narrower
    // column. Those are the ones that come near enough to look bigger, which sells the depth.
    const spread = Math.random() < 0.35 ? 0.4 : 1
    position.set([between(DUST.x[0], DUST.x[1]) * spread, between(DUST.y[0], DUST.y[1]) * spread, 0], i * 3)
    // Most dots take 30 to 75 seconds to cross; a few move up to three times as fast.
    const speed = (1 / between(30, 75)) * (1 + 2 * Math.random() ** 4)
    const size = between(0.6, 1.2) + 0.7 * Math.random() ** 6
    motion.set([Math.random(), speed, size, between(0.2, 0.55)], i * 4)
    wander.set([between(0.15, 0.9), between(0.08, 0.35), between(0, Math.PI * 2)], i * 3)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aMotion', new BufferAttribute(motion, 4))
  geometry.setAttribute('aWander', new BufferAttribute(wander, 3))

  const material = new ShaderMaterial({
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uNear: { value: DUST.near },
      uFar: { value: DUST.far },
      uAspect: { value: 1 },
      uPointer: { value: new Vector2(0, 0) },
      uPart: { value: 0 },
      uRipple: { value: 0 },
      // The wash's material is given this same array, so both see the same rings.
      uRipples: { value: Array.from({ length: RIPPLE_COUNT }, () => new Vector3(0, 0, -1)) },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  return { geometry, material }
}

export function Backdrop() {
  const wash = useMemo(() => {
    const geometry = new BufferGeometry()
    // One triangle that covers the whole screen.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    const initial = BACKDROP_PALETTES[useStage.getState().backdrop]
    const material = new ShaderMaterial({
      vertexShader: backdropVertex,
      fragmentShader: backdropFragment,
      uniforms: {
        uInner: { value: new Color(initial.inner) },
        uOuter: { value: new Color(initial.outer) },
        uFocus: { value: new Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uRipple: { value: 0 },
        uRipples: { value: Array.from({ length: RIPPLE_COUNT }, () => new Vector3(0, 0, -1)) },
      },
      depthTest: false,
      depthWrite: false,
    })
    return { geometry, material }
  }, [])

  const dust = useMemo(() => {
    const made = createDust()
    made.material.uniforms.uRipples = wash.material.uniforms.uRipples
    return made
  }, [wash])

  useFrame((state, delta) => {
    const { camera, size, gl, clock, scene } = state
    const dt = Math.min(delta, 1 / 20)
    const palette = BACKDROP_PALETTES[useStage.getState().backdrop]

    // Gradually crossfade the inner and outer wash colours when moving between differently themed sections.
    easing.dampC(wash.material.uniforms.uInner.value, palette.inner, BACKDROP_SETTLE, dt)
    easing.dampC(wash.material.uniforms.uOuter.value, palette.outer, BACKDROP_SETTLE, dt)
    if (scene.background instanceof Color) {
      easing.dampC(scene.background, palette.outer, BACKDROP_SETTLE, dt)
    }

    // Centre the glow on the brain, which the stage slides sideways with a camera view offset.
    const view = camera.view
    wash.material.uniforms.uFocus.value.x = view?.enabled ? 0.5 - view.offsetX / view.width : 0.5
    const aspect = size.width / size.height
    wash.material.uniforms.uAspect.value = aspect
    dust.material.uniforms.uAspect.value = aspect

    // The cursor effect for this section. Strengths ease, so effects crossfade between sections
    // and the gap in the dots closes softly when the cursor leaves.
    const effect = useStage.getState().cursorEffect
    const { pointer, ripples } = interaction
    const now = interactionTime()
    const dots = dust.material.uniforms
    easing.damp2(dots.uPointer.value, [pointer.x * aspect, pointer.y], CURSOR.follow, dt)
    easing.damp(dots.uPart, 'value', effect === 'part' && pointer.present ? 1 : 0, CURSOR.fade, dt)
    easing.damp(dots.uRipple, 'value', effect === 'ripple' ? 1 : 0, CURSOR.fade, dt)
    wash.material.uniforms.uRipple.value = dots.uRipple.value
    const rings = dots.uRipples.value as Vector3[]
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      rings[i].set(ripples.data[i * 3], ripples.data[i * 3 + 1], now - ripples.data[i * 3 + 2])
    }
    dust.material.uniforms.uTime.value = clock.elapsedTime
    dust.material.uniforms.uPixelRatio.value = gl.getPixelRatio()
  })

  return (
    <>
      <mesh geometry={wash.geometry} material={wash.material} frustumCulled={false} renderOrder={ORDER.backdrop} />
      <points geometry={dust.geometry} material={dust.material} frustumCulled={false} renderOrder={ORDER.dust} />
    </>
  )
}
