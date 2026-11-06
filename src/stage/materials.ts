import { Color, DoubleSide, FrontSide, LessEqualDepth, MeshBasicMaterial, MeshPhysicalMaterial, type IUniform } from 'three'

/**
 * Draw order for clean glass. Translucent folded meshes normally show a mess of overlapping
 * layers. Instead: structures inside the brain draw first, then the shell writes depth only,
 * then the shell draws colour against that depth. Only the front-most surface of the shell
 * ever blends over what is inside. The backdrop and its dots draw before all of it, so they sit
 * behind the brain and still show through the glass.
 */
export const ORDER = { backdrop: -2, dust: -1, target: 1, context: 2, shellDepth: 3, shell: 4, effects: 5 } as const

export interface ShellUniforms {
  uGhost: IUniform<number>
}

const FLESH = new Color('#cf8d78')
const SULCUS = new Color('#3f1214')
const RIM = new Color('#cfe4ff')

/** Outer brain surface. uGhost blends from opaque tissue (0) to rim-lit glass (1). */
export function createShellMaterial(): { material: MeshPhysicalMaterial; uniforms: ShellUniforms } {
  const uniforms: ShellUniforms = { uGhost: { value: 0 } }

  const material = new MeshPhysicalMaterial({
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.38,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new Color('#ffb9a4'),
    transparent: true,
    depthWrite: false,
    depthFunc: LessEqualDepth,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGhost = uniforms.uGhost
    shader.uniforms.uFlesh = { value: FLESH }
    shader.uniforms.uSulcus = { value: SULCUS }
    shader.uniforms.uRim = { value: RIM }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying vec2 vShade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = color.rg;')

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vShade;
         uniform float uGhost;
         uniform vec3 uFlesh;
         uniform vec3 uSulcus;
         uniform vec3 uRim;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float crown = smoothstep(0.02, 0.62, vShade.r);
         float crease = smoothstep(0.03, 0.5, vShade.g);
         float cavity = crown * mix(0.5, 1.0, crease);
         diffuseColor.rgb = mix(uSulcus, uFlesh, cavity);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
         float occlusion = mix(0.22, 1.0, cavity);
         reflectedLight.indirectDiffuse *= occlusion;
         reflectedLight.directDiffuse *= mix(0.55, 1.0, cavity);
         reflectedLight.indirectSpecular *= occlusion;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
         float facing = saturate(abs(dot(normalize(vViewPosition), normal)));
         float rim = pow(1.0 - facing, 2.6);
         // A thin warm edge fakes light scattering through tissue.
         vec3 tissue = gl_FragColor.rgb + vec3(0.42, 0.13, 0.1) * pow(1.0 - facing, 3.0) * cavity;
         vec3 glass = uRim * (0.05 + rim * 1.1);
         gl_FragColor.rgb = mix(tissue, glass, uGhost);
         gl_FragColor.a = mix(1.0, clamp(0.015 + rim * 0.62, 0.0, 1.0), uGhost);`,
      )
  }
  material.customProgramCacheKey = () => 'brain-shell'

  return { material, uniforms }
}

/** Depth-only twin of the shell. Colour is switched off; see ORDER above. */
export function createShellDepthMaterial() {
  return new MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: DoubleSide })
}

export interface StructureUniforms {
  uFocus: IUniform<number>
  uDim: IUniform<number>
  uGlow: IUniform<Color>
  uPulse: IUniform<number>
}

export interface StructureOptions {
  /** A region cut from the cortex surface: an open sheet, seen only when it is a target. */
  patch?: boolean
}

/**
 * A structure inside the brain. uFocus 1 makes it a solid glowing target. uDim fades
 * non-targets back to a faint outline so the eye goes to the target.
 */
export function createStructureMaterial(options: StructureOptions = {}): {
  material: MeshPhysicalMaterial
  uniforms: StructureUniforms
} {
  const uniforms: StructureUniforms = {
    uFocus: { value: 0 },
    uDim: { value: 0 },
    uGlow: { value: new Color('#ff7a3d') },
    uPulse: { value: 0 },
  }

  const material = new MeshPhysicalMaterial({
    color: new Color('#c98f80'),
    roughness: 0.34,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
    transparent: true,
    side: options.patch ? DoubleSide : FrontSide,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFocus = uniforms.uFocus
    shader.uniforms.uDim = uniforms.uDim
    shader.uniforms.uGlow = uniforms.uGlow
    shader.uniforms.uPulse = uniforms.uPulse

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uFocus;
         uniform float uDim;
         uniform vec3 uGlow;
         uniform float uPulse;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.rgb = mix(diffuseColor.rgb, uGlow, uFocus * 0.9);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
         float facing = saturate(abs(dot(normalize(vViewPosition), normal)));
         float rim = pow(1.0 - facing, 2.4);
         // Only the rim passes 1.0, which is what the bloom pass picks up. The body keeps its form.
         gl_FragColor.rgb += uGlow * uFocus * (0.2 + rim * 1.45 + uPulse * 0.22);
         float quiet = uDim * (1.0 - uFocus);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.74, 0.92) * (0.04 + rim * 0.6), quiet);
         gl_FragColor.a = mix(1.0, clamp(0.015 + rim * 0.2, 0.0, 1.0), quiet);`,
      )
  }
  material.customProgramCacheKey = () => `brain-structure-${options.patch ? 'patch' : 'solid'}`

  return { material, uniforms }
}
