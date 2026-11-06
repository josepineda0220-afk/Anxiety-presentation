import { Box3, Sphere, Vector3 } from 'three'
import { CIRCUITS, REGIONS, isIdle, type CameraPose, type Focus } from './regions'

export const FRONT_VIEW: CameraPose = { yaw: 0, pitch: -0.06 }

export interface FocusPlan {
  idle: boolean
  /** Mesh node name to glow colour, for everything that should stay solid. */
  targets: Map<string, string>
  center: Vector3
  distance: number
  yaw: number
  pitch: number
}

/** Every mesh node a focus lights up, with the colour it should glow. */
export function targetNodes(focus: Focus): Map<string, string> {
  const out = new Map<string, string>()
  for (const circuitId of focus.circuits) {
    const circuit = CIRCUITS[circuitId]
    for (const stop of circuit.stops) out.set(`${stop}_${circuit.side}`, REGIONS[stop].color)
  }
  for (const id of focus.regions) {
    for (const node of REGIONS[id].nodes) out.set(node, REGIONS[id].color)
  }
  return out
}

function firstView(focus: Focus): CameraPose {
  if (focus.pose) return focus.pose
  if (focus.circuits.length > 0) return CIRCUITS[focus.circuits[0]].view
  return REGIONS[focus.regions[0]].view
}

/**
 * Works out where the brain should sit for a focus. Framing comes from the bounding sphere of
 * the selected structures, so any combination works without hand-tuned camera positions.
 */
export function planFocus(
  focus: Focus,
  bounds: Map<string, Box3>,
  fovDegrees: number,
  wholeBrain: Box3,
): FocusPlan {
  const halfFov = (fovDegrees * Math.PI) / 360
  const fit = (radius: number) => radius / Math.sin(halfFov)

  if (isIdle(focus)) {
    const sphere = wholeBrain.getBoundingSphere(new Sphere())
    return {
      idle: true,
      targets: new Map(),
      center: sphere.center.clone(),
      distance: fit(sphere.radius) * 0.8,
      yaw: FRONT_VIEW.yaw,
      pitch: FRONT_VIEW.pitch,
    }
  }

  const targets = targetNodes(focus)
  const box = new Box3()
  for (const node of targets.keys()) {
    const nodeBox = bounds.get(node)
    if (nodeBox) box.union(nodeBox)
  }

  const sphere = box.getBoundingSphere(new Sphere())
  const view = firstView(focus)
  // Never zoom in so far that a small structure loses its surroundings.
  const distance = view.distance ?? Math.max(fit(sphere.radius) * 1.35, fit(1.55))
  return { idle: false, targets, center: sphere.center.clone(), distance, yaw: view.yaw, pitch: view.pitch }
}
