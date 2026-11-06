/** Every brain structure the app can point at. Node names match public/models/brain.glb. */

export type RegionId =
  | 'amygdala'
  | 'hippocampus'
  | 'caudate'
  | 'putamen'
  | 'pallidum'
  | 'thalamus'
  | 'dlpfc'
  | 'ofc'
  | 'acc'
  | 'insula'

export type CircuitId = 'cstc'

export interface CameraPose {
  /** Turn around the vertical axis, in radians. 0 is the front of the face. */
  yaw: number
  /** Tilt, in radians. Negative shows the underside. */
  pitch: number
  /** Optional manual zoom. Left out, framing is computed from the targets. */
  distance?: number
}

export interface Focus {
  regions: RegionId[]
  circuits: CircuitId[]
  pose?: CameraPose
}

export interface Region {
  id: RegionId
  label: string
  nodes: string[]
  color: string
  view: CameraPose
}

const FEAR = '#ff6a2b'
const WORRY = '#3fb6ff'
const NEUTRAL = '#e8b65f'

/** Each stop of the worry loop gets its own shade so the path can be followed by eye. */
const LOOP = {
  cortex: '#39c6ff',
  caudate: '#2f8dff',
  putamen: '#5a6dff',
  pallidum: '#a06bff',
  thalamus: '#22dcc0',
}

const bilateral = (id: string) => [`${id}_l`, `${id}_r`]

export const REGIONS: Record<RegionId, Region> = {
  amygdala: { id: 'amygdala', label: 'Amygdala', nodes: bilateral('amygdala'), color: FEAR, view: { yaw: 0, pitch: -0.1 } },
  hippocampus: { id: 'hippocampus', label: 'Hippocampus', nodes: bilateral('hippocampus'), color: NEUTRAL, view: { yaw: -0.7, pitch: -0.12 } },
  caudate: { id: 'caudate', label: 'Caudate nucleus', nodes: bilateral('caudate'), color: LOOP.caudate, view: { yaw: -0.8, pitch: 0.05 } },
  putamen: { id: 'putamen', label: 'Putamen', nodes: bilateral('putamen'), color: LOOP.putamen, view: { yaw: -0.8, pitch: 0.05 } },
  pallidum: { id: 'pallidum', label: 'Globus pallidus', nodes: bilateral('pallidum'), color: LOOP.pallidum, view: { yaw: -0.8, pitch: 0.05 } },
  thalamus: { id: 'thalamus', label: 'Thalamus', nodes: bilateral('thalamus'), color: LOOP.thalamus, view: { yaw: -0.8, pitch: 0.05 } },
  dlpfc: { id: 'dlpfc', label: 'Dorsolateral prefrontal cortex', nodes: bilateral('dlpfc'), color: LOOP.cortex, view: { yaw: -0.75, pitch: 0.12 } },
  ofc: { id: 'ofc', label: 'Orbitofrontal cortex', nodes: bilateral('ofc'), color: NEUTRAL, view: { yaw: -0.25, pitch: -0.5 } },
  acc: { id: 'acc', label: 'Anterior cingulate cortex', nodes: bilateral('acc'), color: NEUTRAL, view: { yaw: -0.9, pitch: 0.15 } },
  insula: { id: 'insula', label: 'Insula', nodes: bilateral('insula'), color: NEUTRAL, view: { yaw: -1.25, pitch: 0 } },
}

export interface Circuit {
  id: CircuitId
  label: string
  /** Stops in loop order. The path closes back to the first stop. */
  stops: RegionId[]
  /** Loops are drawn on one side. Both at once stack into a single unreadable shape. */
  side: 'l' | 'r'
  color: string
  view: CameraPose
}

export const CIRCUITS: Record<CircuitId, Circuit> = {
  cstc: {
    id: 'cstc',
    label: 'CSTC loop',
    stops: ['dlpfc', 'caudate', 'putamen', 'pallidum', 'thalamus'],
    side: 'r',
    color: WORRY,
    // Seen through the near hemisphere, so every stop of the loop is visible at once.
    view: { yaw: -0.95, pitch: 0.32 },
  },
}

/** Structures that make up the outer shell and turn to glass during a focus. */
export const SHELL_NODES = ['cortex_l', 'cortex_r', 'cerebellum', 'brainstem']

/** Regions cut from the cortex surface. Hidden unless they are a target. */
export const PATCH_REGIONS: RegionId[] = ['dlpfc', 'ofc', 'acc', 'insula']
export const isPatchNode = (node: string) => PATCH_REGIONS.some((id) => node.startsWith(`${id}_`))

export const IDLE_FOCUS: Focus = { regions: [], circuits: [] }

export const isIdle = (focus: Focus) => focus.regions.length === 0 && focus.circuits.length === 0
