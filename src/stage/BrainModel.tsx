import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { easing } from 'maath'
import { Box3, Color, Euler, Group, Mesh, PerspectiveCamera, Quaternion, Vector3, type Material } from 'three'
import { FRONT_VIEW, planFocus } from '../brain/focus'
import { SHELL_NODES, isPatchNode } from '../brain/regions'
import { useStage } from './focusStore'
import {
  ORDER,
  createShellDepthMaterial,
  createShellMaterial,
  createStructureMaterial,
  type StructureUniforms,
} from './materials'

const MODEL_URL = '/models/brain.glb'
useGLTF.preload(MODEL_URL)

/** Seconds to settle. Higher is slower and heavier. */
const SETTLE = { move: 0.62, fade: 0.42 }
const IDLE_SPIN = 0.16 // radians per second
const IDLE_TILT = FRONT_VIEW.pitch

interface Structure {
  name: string
  uniforms: StructureUniforms
  mesh: Mesh
}

export function BrainModel() {
  const { scene } = useGLTF(MODEL_URL)
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const size = useThree((state) => state.size)
  const focus = useStage((state) => state.focus)

  const pivot = useRef<Group>(null!)
  const inner = useRef<Group>(null!)

  const stage = useMemo(() => {
    const shell = createShellMaterial()
    const shellDepth = createShellDepthMaterial()
    const structures: Structure[] = []
    const bounds = new Map<string, Box3>()
    const whole = new Box3()
    const root = new Group()
    const meshes: Mesh[] = []
    scene.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh)
    })

    scene.updateMatrixWorld(true)

    // Compression stores vertices in a normalised box, and each node's transform restores the
    // true position and size. Every copy has to carry that transform.
    const placed = (source: Mesh, material: Material) => {
      const mesh = new Mesh(source.geometry, material)
      source.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale)
      return mesh
    }

    for (const source of meshes) {
      const name = source.name.replace(/\.\d+$/, '') || source.parent?.name || ''
      source.geometry.computeBoundingBox()
      const box = source.geometry.boundingBox!.clone().applyMatrix4(source.matrixWorld)
      bounds.set(name, box)
      whole.union(box)

      if (SHELL_NODES.includes(name)) {
        const depth = placed(source, shellDepth)
        depth.renderOrder = ORDER.shellDepth
        const color = placed(source, shell.material)
        color.renderOrder = ORDER.shell
        root.add(depth, color)
      } else {
        const { material, uniforms } = createStructureMaterial({ patch: isPatchNode(name) })
        const mesh = placed(source, material)
        mesh.renderOrder = ORDER.context
        root.add(mesh)
        structures.push({ name, uniforms, mesh })
      }
    }
    return { shell, structures, bounds, whole, root }
  }, [scene])

  const plan = useMemo(
    () => planFocus(focus, stage.bounds, camera.fov, stage.whole),
    [focus, stage, camera.fov],
  )

  // Targets draw first so the glass can blend over them.
  useEffect(() => {
    for (const { name, mesh, uniforms } of stage.structures) {
      const glow = plan.targets.get(name)
      mesh.renderOrder = glow ? ORDER.target : ORDER.context
      if (glow) uniforms.uGlow.value = new Color(glow)
    }
  }, [plan, stage])

  const motion = useRef({
    spin: 0,
    spinSpeed: 0,
    idleFor: 0,
    shift: 0.17,
    targetQuat: new Quaternion(),
    euler: new Euler(0, 0, 0, 'XYZ'),
    offset: new Vector3(),
  })

  useFrame((state, delta) => {
    const m = motion.current
    const dt = Math.min(delta, 1 / 20)

    // Idle: come back to the front first, then ease into a slow turn.
    if (plan.idle) {
      m.idleFor += dt
      const wantSpin = m.idleFor > 1.5 ? IDLE_SPIN : 0
      easing.damp(m, 'spinSpeed', wantSpin, 1.1, dt)
      m.spin += m.spinSpeed * dt
      m.euler.set(IDLE_TILT, m.spin, 0)
    } else {
      m.idleFor = 0
      m.spin = 0
      m.spinSpeed = 0
      m.euler.set(plan.pitch, plan.yaw, 0)
    }
    m.targetQuat.setFromEuler(m.euler)
    easing.dampQ(pivot.current.quaternion, m.targetQuat, plan.idle && m.idleFor > 1.5 ? 0.25 : SETTLE.move, dt)

    // Slide the model so the focus point sits on the pivot.
    m.offset.copy(plan.center).negate()
    easing.damp3(inner.current.position, m.offset, SETTLE.move, dt)

    // A slow breath keeps the scene alive when nothing is moving.
    const t = state.clock.elapsedTime
    pivot.current.position.y = Math.sin(t * 0.55) * 0.018

    easing.damp(camera.position, 'z', plan.distance, SETTLE.move, dt)

    // Shift the whole picture to clear the text column, with no parallax.
    easing.damp(m, 'shift', useStage.getState().shift, SETTLE.move, dt)
    camera.setViewOffset(size.width, size.height, -m.shift * size.width, 0, size.width, size.height)

    const ghost = plan.idle ? 0 : 1
    easing.damp(stage.shell.uniforms.uGhost, 'value', ghost, SETTLE.fade, dt)
    for (const { name, uniforms, mesh } of stage.structures) {
      const isTarget = plan.targets.has(name)
      easing.damp(uniforms.uFocus, 'value', isTarget ? 1 : 0, SETTLE.fade, dt)
      easing.damp(uniforms.uDim, 'value', plan.idle ? 0 : 1, SETTLE.fade, dt)
      uniforms.uPulse.value = isTarget ? 0.5 + 0.5 * Math.sin(t * 2.1) : 0
      // A hidden patch must not write depth, or it would punch a hole in the glass.
      if (isPatchNode(name)) mesh.visible = uniforms.uFocus.value > 0.004
    }
  })

  return (
    <group ref={pivot}>
      <group ref={inner}>
        <primitive object={stage.root} />
      </group>
    </group>
  )
}
