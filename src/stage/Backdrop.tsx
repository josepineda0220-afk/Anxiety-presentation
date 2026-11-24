import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { easing } from 'maath'
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
  ZeroFactor,
  type DirectionalLight,
} from 'three'
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
 * The hex values below are what it takes to come out the other side as the colour named.
 */
export interface BackdropPalette {
  /** The wash right behind the brain. */
  inner: string
  /** The wash toward the edges, before the vignette darkens the corners. */
  outer: string
  /**
   * Brightness of the wash. Tone mapping holds a plain colour well short of white, so a light
   * backdrop has to be pushed past 1 to come out light.
   */
  glow: number
  /** Colour of the drifting dots. */
  dust: string
  /**
   * How the dots mix in: 0 adds light, so they glow on a dark wash; 1 lays them over the wash
   * like paint, so they still show on a light one.
   */
  dustOver: number
  /** Overall strength of the dots. */
  dustGain: number
  /**
   * Extra depth cues, 0 to 1, for a wash too dark or too flat to show depth by itself: a slow
   * drifting haze in the wash, and far dots that are dimmer, smaller and lost in that haze while
   * near ones are brighter.
   */
  depth: number
  /** Colour of that haze, and of the far dots fading into it. */
  haze: string
  /** Strength of a light from behind the brain, so its edges stand off a dark wash. */
  rim: number
}

export const BACKDROP_PALETTES: Record<BackdropTheme, BackdropPalette> = {
  blue: {
    /** Renders as #10255a. */
    inner: '#26355f',
    /** Renders as #081430. */
    outer: '#1b2640',
    glow: 1,
    dust: '#ffffff',
    dustOver: 0,
    dustGain: 1,
    depth: 0,
    haze: '#3a4f88',
    rim: 0,
  },
  purple: {
    /** Deep lavender glow right behind the brain. */
    inner: '#432c68',
    /** Deep plum-violet toward the edges. */
    outer: '#271a42',
    glow: 1,
    dust: '#ffffff',
    dustOver: 0,
    dustGain: 1,
    depth: 0,
    haze: '#5e4390',
    rim: 0,
  },
  pink: {
    /** Soft pastel pink, a touch lighter behind the brain. */
    inner: '#ffb6cb',
    /** Pastel rose toward the edges, which the vignette deepens to dusty mauve. */
    outer: '#f09ab6',
    glow: 1.35,
    /** Deeper rose specks laid over the pastel, so they read on a light wash. */
    dust: '#a8466f',
    dustOver: 1,
    dustGain: 2.2,
    depth: 0.55,
    haze: '#ffcfdd',
    rim: 0,
  },
  black: {
    /**
     * Black, but not flat black: a faint cool lift behind the brain keeps a gradient for the eye,
     * and the depth cues and rim light below do the rest.
     */
    inner: '#1a1f2c',
    outer: '#000000',
    glow: 1,
    dust: '#ffffff',
    dustOver: 0,
    dustGain: 1.15,
    depth: 1,
    haze: '#2a3550',
    rim: 2.4,
  },
}

export const BACKDROP = BACKDROP_PALETTES.blue

/** Seconds for the backdrop to crossfade when switching between differently themed sections. */
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
  uniform float uTime;
  uniform float uDepth;
  uniform vec3 uHaze;
  uniform float uGlow;
  varying vec2 vUv;
  ${rippleChunk}

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }
  // Soft billowing fog, a few octaves of value noise.
  float fog(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 q = (vUv - uFocus) * vec2(uAspect, 1.0);
    float r = length(q);
    vec3 color = mix(uInner, uOuter, smoothstep(0.0, 1.3, r)) * uGlow;

    // Depth haze: two layers of fog drifting at different speeds, so it reads as volume, not a
    // texture. Strongest in a broad band around the brain, thinning toward the corners.
    if (uDepth > 0.001) {
      vec2 p = vUv * vec2(uAspect, 1.0);
      float nearLayer = fog(p * 1.6 + vec2(uTime * 0.012, uTime * 0.004));
      float farLayer = fog(p * 3.1 - vec2(uTime * 0.006, -uTime * 0.003) + 4.0);
      float mist = smoothstep(0.3, 0.85, nearLayer) * 0.65 + smoothstep(0.35, 0.9, farLayer) * 0.35;
      float band = 1.0 - smoothstep(0.15, 1.25, r);
      color = mix(color, uHaze * uGlow, mist * (0.35 + 0.65 * band) * 0.55 * uDepth);
    }

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
  uniform float uDepth;
  uniform float uSparkle;
  varying float vAlpha;
  varying float vFar;
  varying float vGlint;
  varying float vHue;
  varying float vScale;
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
    // Depth cues: near dots a little larger and brighter, far ones dimmer and lost in the haze.
    size *= 1.0 + uDepth * 0.35 * trip;
    vFar = uDepth * (1.0 - trip);
    float fade = smoothstep(0.0, 0.15, trip) * (1.0 - smoothstep(0.86, 1.0, trip));
    float twinkle = 0.8 + 0.2 * sin(uTime * (0.7 + aWander.y * 4.0) + aWander.z * 7.0);
    // Glitter shimmers harder and faster than plain dust.
    float shimmer = 0.6 + 0.4 * sin(uTime * (2.2 + aWander.y * 9.0) + aWander.z * 11.0);
    twinkle = mix(twinkle, shimmer, uSparkle);
    vAlpha = aMotion.w * fade * twinkle;
    vAlpha *= mix(1.0, 0.3 + 1.05 * trip, uDepth);

    // Sparkle: every so often a dot catches the light and flashes a little star. About half the
    // dots flash fully; the rest only glint faintly, so the field never looks uniform.
    float rate = 0.3 + 0.7 * fract(aWander.z * 3.7);
    float flash = pow(max(0.0, sin(uTime * rate * 3.14159 + aWander.z * 13.0 + aMotion.x * 29.0)), 18.0);
    float strong = step(0.5, fract(aWander.z * 5.3 + aMotion.x * 7.1));
    vGlint = flash * uSparkle * (0.3 + 0.7 * strong);
    vHue = fract(aWander.z * 0.37 + aMotion.x * 1.9);
    // The sprite grows to leave room for the star's rays; the core is drawn the same size as before.
    vScale = 1.0 + 3.5 * uSparkle;

    // A sprite under about 1.5 px flickers as it moves, so hold that size and dim it instead.
    float smallest = 1.5 * uPixelRatio;
    vAlpha *= min(1.0, (size / smallest) * (size / smallest));
    gl_PointSize = max(size, smallest) * vScale;

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
  uniform vec3 uColor;
  uniform vec3 uHaze;
  uniform float uOver;
  uniform float uGain;
  uniform float uSparkle;
  varying float vAlpha;
  varying float vFar;
  varying float vGlint;
  varying float vHue;
  varying float vScale;
  void main() {
    // In units of the plain dot: the core spans -0.5 to 0.5, the sprite around it holds the rays.
    vec2 c = (gl_PointCoord - 0.5) * vScale;
    float r = length(c);
    float core = 1.0 - smoothstep(0.12, 0.5, r);

    float reach = 0.5 * vScale;
    vec2 a = abs(c);
    float rays = exp(-a.y * 26.0) * max(0.0, 1.0 - a.x / reach) + exp(-a.x * 26.0) * max(0.0, 1.0 - a.y / reach);
    // Fainter, shorter diagonal rays make it a glint rather than a plus sign.
    vec2 d = abs(vec2(c.x + c.y, c.x - c.y)) * 0.7071;
    rays += 0.45 * (exp(-d.y * 30.0) * max(0.0, 1.0 - d.x / (reach * 0.55)) + exp(-d.x * 30.0) * max(0.0, 1.0 - d.y / (reach * 0.55)));
    float halo = exp(-r * r * 9.0);
    float alpha = vAlpha * (core * (1.0 + 3.0 * vGlint) + (rays * 2.2 + halo * 0.8) * vGlint);

    // Far dots take on the haze. Glitter is faintly iridescent, and flashes toward white.
    vec3 color = mix(uColor, uHaze, vFar * 0.7);
    vec3 iris = 0.5 + 0.5 * cos(6.28318 * (vHue + vec3(0.0, 0.33, 0.67)));
    color *= mix(vec3(1.0), 0.65 + 0.5 * iris, 0.4 * uSparkle);
    color = mix(color, vec3(1.0), clamp(vGlint * 1.5, 0.0, 0.9));
    // Past white at the peak of a flash, so the bloom pass gives it a glow even on a light wash.
    color *= 1.0 + 4.0 * vGlint;

    alpha *= uGain;
    // Premultiplied: with uOver at 0 this adds light, at 1 it covers what is behind like paint.
    gl_FragColor = vec4(color * alpha, min(alpha * uOver, 1.0));
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
      uDepth: { value: 0 },
      uSparkle: { value: 0 },
      uColor: { value: new Color('#ffffff') },
      uHaze: { value: new Color('#3a4f88') },
      uOver: { value: 0 },
      uGain: { value: 1 },
      // The wash's material is given this same array, so both see the same rings.
      uRipples: { value: Array.from({ length: RIPPLE_COUNT }, () => new Vector3(0, 0, -1)) },
    },
    transparent: true,
    depthWrite: false,
    // Premultiplied alpha, so the shader can slide between adding light and covering like paint.
    // The target's alpha is left alone.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
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
        uTime: { value: 0 },
        uDepth: { value: initial.depth },
        uGlow: { value: initial.glow },
        uHaze: { value: new Color(initial.haze) },
      },
      depthTest: false,
      depthWrite: false,
    })
    return { geometry, material }
  }, [])

  const dust = useMemo(() => {
    const made = createDust()
    made.material.uniforms.uRipples = wash.material.uniforms.uRipples
    // Both see the same depth and haze, which ease together.
    made.material.uniforms.uDepth = wash.material.uniforms.uDepth
    made.material.uniforms.uHaze = wash.material.uniforms.uHaze
    const initial = BACKDROP_PALETTES[useStage.getState().backdrop]
    made.material.uniforms.uColor.value.set(initial.dust)
    made.material.uniforms.uOver.value = initial.dustOver
    made.material.uniforms.uGain.value = initial.dustGain
    made.material.uniforms.uSparkle.value = useStage.getState().particles === 'sparkle' ? 1 : 0
    return made
  }, [wash])

  useFrame((state, delta) => {
    const { camera, size, gl, clock, scene } = state
    const dt = Math.min(delta, 1 / 20)
    const { backdrop, particles } = useStage.getState()
    const palette = BACKDROP_PALETTES[backdrop]

    // Gradually crossfade everything when moving between differently themed sections.
    const washed = wash.material.uniforms
    easing.dampC(washed.uInner.value, palette.inner, BACKDROP_SETTLE, dt)
    easing.dampC(washed.uOuter.value, palette.outer, BACKDROP_SETTLE, dt)
    easing.dampC(washed.uHaze.value, palette.haze, BACKDROP_SETTLE, dt)
    easing.damp(washed.uDepth, 'value', palette.depth, BACKDROP_SETTLE, dt)
    easing.damp(washed.uGlow, 'value', palette.glow, BACKDROP_SETTLE, dt)
    washed.uTime.value = clock.elapsedTime
    const dusted = dust.material.uniforms
    easing.dampC(dusted.uColor.value, palette.dust, BACKDROP_SETTLE, dt)
    easing.damp(dusted.uOver, 'value', palette.dustOver, BACKDROP_SETTLE, dt)
    easing.damp(dusted.uGain, 'value', palette.dustGain, BACKDROP_SETTLE, dt)
    easing.damp(dusted.uSparkle, 'value', particles === 'sparkle' ? 1 : 0, BACKDROP_SETTLE, dt)
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

/**
 * A light from behind and above the brain. Off on most backdrops; on black it rims the brain's
 * edges so its silhouette stands off the background instead of sinking into it.
 */
export function RimLight() {
  const light = useRef<DirectionalLight>(null)
  useFrame((_, delta) => {
    if (!light.current) return
    const target = BACKDROP_PALETTES[useStage.getState().backdrop].rim
    easing.damp(light.current, 'intensity', target, BACKDROP_SETTLE, Math.min(delta, 1 / 20))
  })
  return <directionalLight ref={light} position={[0.5, 3, -7]} intensity={0} color="#bcd2ff" />
}
