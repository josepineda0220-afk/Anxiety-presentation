import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { easing } from 'maath'
import { Box3, Color, Euler, Group, Mesh, PerspectiveCamera, Quaternion, Sphere, Vector3, type Material } from 'three'
import { FRONT_VIEW, planFocus } from '../brain/focus'
import { IDLE_FOCUS, SHELL_NODES, isPatchNode } from '../brain/regions'
import { useStage } from './focusStore'
import { interaction } from './interaction'
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

/** While the viewer is turning the brain by hand: how fast it follows, and how far the parts go. */
const EXPLORE = {
  /** Seconds for the brain to catch up with the hand. */
  follow: 0.09,
  /** Seconds for the parts to reach where the pinch put them. */
  spread: 0.16,
  /** Each part travels this many times its own distance from the middle of the brain. */
  reach: 1.25,
  /** How much further back the camera sits when the parts are fully apart. */
  pullBack: 0.55,
}

const SCREEN_X = new Vector3(1, 0, 0)
const SCREEN_Y = new Vector3(0, 1, 0)

/** One piece of the brain that moves as a unit when the parts are pulled apart. */
interface Part {
  mesh: Mesh
  home: Vector3
  /** From the middle of the brain to the middle of this piece. */
  away: Vector3
}

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
    const parts: (Part & { name: string })[] = []
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
        for (const mesh of [depth, color]) parts.push({ name, mesh, home: mesh.position.clone(), away: new Vector3() })
      } else {
        const { material, uniforms } = createStructureMaterial({ patch: isPatchNode(name) })
        const mesh = placed(source, material)
        mesh.renderOrder = ORDER.context
        root.add(mesh)
        structures.push({ name, uniforms, mesh })
        parts.push({ name, mesh, home: mesh.position.clone(), away: new Vector3() })
      }
    }

    // Each piece moves straight out from the middle of the brain. A patch is a piece of cortex
    // surface, so it goes wherever its hemisphere goes.
    const middle = whole.getCenter(new Vector3())
    for (const part of parts) {
      const side = part.name.slice(-2)
      const carrier = isPatchNode(part.name) ? bounds.get(`cortex${side}`) : undefined
      ;(carrier ?? bounds.get(part.name)!).getCenter(part.away).sub(middle)
    }
    return { shell, structures, bounds, whole, root, parts }
  }, [scene])

  const plan = useMemo(
    () => planFocus(focus, stage.bounds, camera.fov, stage.whole),
    [focus, stage, camera.fov],
  )

  /** How the whole brain is framed, for when the viewer takes hold of it on a close-up slide. */
  const wholeView = useMemo(
    () => planFocus(IDLE_FOCUS, stage.bounds, camera.fov, stage.whole),
    [stage, camera.fov],
  )
  const wholeRadius = useMemo(() => stage.whole.getBoundingSphere(new Sphere()).radius, [stage])

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
    exploring: false,
    /** Where the viewer has turned the brain to. */
    userQuat: new Quaternion(),
    turn: new Quaternion(),
    explode: 0,
    appliedExplode: 0,
    projected: new Vector3(),
  })

  useFrame((state, delta) => {
    const m = motion.current
    const dt = Math.min(delta, 1 / 20)

    const exploring = useStage.getState().explore
    const hand = interaction.explore

    if (exploring) {
      // Start from wherever the brain is right now, so taking hold of it never makes it jump.
      if (!m.exploring) m.userQuat.copy(pivot.current.quaternion)
      if (hand.turnX !== 0 || hand.turnY !== 0) {
        // Turns are around the screen's own axes, so a drag always moves the surface under the finger.
        m.userQuat.premultiply(m.turn.setFromAxisAngle(SCREEN_Y, hand.turnX))
        m.userQuat.premultiply(m.turn.setFromAxisAngle(SCREEN_X, hand.turnY)).normalize()
        hand.turnX = 0
        hand.turnY = 0
      }
      easing.dampQ(pivot.current.quaternion, m.userQuat, EXPLORE.follow, dt)
      m.idleFor = 0
      m.spinSpeed = 0
    } else if (plan.idle) {
      // Idle: come back to the front first, then ease into a slow turn.
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
    if (!exploring) {
      m.targetQuat.setFromEuler(m.euler)
      easing.dampQ(pivot.current.quaternion, m.targetQuat, plan.idle && m.idleFor > 1.5 ? 0.25 : SETTLE.move, dt)
    }
    m.exploring = exploring

    // Pull the parts apart as far as the pinch asks, and bring them home when the brain is let go.
    easing.damp(m, 'explode', exploring ? hand.explode : 0, EXPLORE.spread, dt)
    if (m.explode !== m.appliedExplode) {
      m.appliedExplode = m.explode
      for (const part of stage.parts) {
        part.mesh.position.copy(part.home).addScaledVector(part.away, m.explode * EXPLORE.reach)
      }
    }

    // Slide the model so the focus point sits on the pivot. In the hand, that is the whole brain.
    const framing = exploring ? wholeView : plan
    m.offset.copy(framing.center).negate()
    easing.damp3(inner.current.position, m.offset, SETTLE.move, dt)

    // A slow breath keeps the scene alive when nothing is moving.
    const t = state.clock.elapsedTime
    pivot.current.position.y = Math.sin(t * 0.55) * 0.018

    easing.damp(camera.position, 'z', framing.distance * (1 + m.explode * EXPLORE.pullBack), SETTLE.move, dt)

    // Shift the whole picture to clear the text column, with no parallax.
    easing.damp(m, 'shift', useStage.getState().shift, SETTLE.move, dt)
    camera.setViewOffset(size.width, size.height, -m.shift * size.width, 0, size.width, size.height)

    // Where the brain is on screen, so a double tap on it can be told from one beside it.
    m.projected.set(0, 0, 0).project(camera)
    const halfFov = (camera.fov * Math.PI) / 360
    const onScreen = interaction.brainOnScreen
    onScreen.x = ((m.projected.x + 1) / 2) * size.width
    onScreen.y = ((1 - m.projected.y) / 2) * size.height
    onScreen.radius = (wholeRadius / (camera.position.z * Math.tan(halfFov))) * (size.height / 2)

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
