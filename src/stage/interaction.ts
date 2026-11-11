import { createRippleBuffer } from './gestures'

/**
 * Live pointer and gesture state, shared between the DOM listeners and the render loop.
 * A plain object, not a store: it changes every pointer move and is only read once a frame.
 */
export const interaction = {
  pointer: {
    /** Position in normalised device coordinates: -1 to 1, y up. */
    x: 0,
    y: 0,
    /** Seconds (performance.now() / 1000) of the last move. The effect fades when it goes stale. */
    movedAt: -1000,
    /** False once the pointer has left the window or the finger has lifted. */
    present: false,
  },
  ripples: createRippleBuffer(),
  explore: {
    /** Rotation asked for since the last frame, in radians around the screen's Y and X axes. */
    turnX: 0,
    turnY: 0,
    /** How far apart the parts should be, 0 to 1. */
    explode: 0,
  },
  /** Where the brain is on screen, in CSS pixels, for telling a tap on it from a tap beside it. */
  brainOnScreen: { x: 0, y: 0, radius: 0 },
}

/** Seconds on the clock the pointer and ripples are timed with. */
export const interactionTime = () => performance.now() / 1000
