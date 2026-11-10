/** Pure gesture maths for the stage: double taps, pinch-to-separate, and cursor ripples. */

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export interface Tap {
  x: number
  y: number
  /** Milliseconds. */
  time: number
}

const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_PX = 32

/**
 * Reports a double tap: two taps close together in time and place. Done by hand because
 * `dblclick` is unreliable for touch on iOS. A third quick tap starts over, it does not chain.
 */
export function createTapDetector() {
  let last: Tap | null = null
  return {
    /** Feed every finished tap. True when it completes a double tap. */
    tap(tap: Tap): boolean {
      const isDouble =
        last !== null &&
        tap.time - last.time <= DOUBLE_TAP_MS &&
        Math.hypot(tap.x - last.x, tap.y - last.y) <= DOUBLE_TAP_PX
      last = isDouble ? null : tap
      return isDouble
    },
    reset() {
      last = null
    },
  }
}

/**
 * How far apart the brain's parts are, 0 (whole) to 1 (fully apart), after the fingers move.
 * `ratio` is the finger spread now over the spread a moment ago, so above 1 is pinching out.
 */
export function pinchToExplode(current: number, ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return clamp01(current)
  return clamp01(current + (ratio - 1) * 1.1)
}

/** The same for a trackpad pinch, which browsers report as a wheel event with ctrl held. */
export function wheelToExplode(current: number, deltaY: number): number {
  return clamp01(current - deltaY * 0.012)
}

export const RIPPLE_COUNT = 8
/** Seconds a ripple lives. Matches the fade in the shader. */
export const RIPPLE_LIFE = 2.4
const RIPPLE_MIN_GAP = 0.11 // seconds
const RIPPLE_MIN_TRAVEL = 0.07 // in screen heights

export interface RippleBuffer {
  /** x, y, start time for each ripple, flat. x and y are in aspect-corrected screen space. */
  data: Float32Array
  next: number
  lastX: number
  lastY: number
  lastTime: number
}

export function createRippleBuffer(): RippleBuffer {
  const data = new Float32Array(RIPPLE_COUNT * 3)
  // Start times far in the past, so nothing is drawn until the pointer moves.
  for (let i = 0; i < RIPPLE_COUNT; i++) data[i * 3 + 2] = -1000
  return { data, next: 0, lastX: Infinity, lastY: Infinity, lastTime: -1000 }
}

/**
 * Drops a new ripple where the pointer is, but only once it has moved on a little and a moment
 * has passed, so a moving cursor leaves a trail of rings and not one smear. True if it did.
 */
export function pushRipple(buffer: RippleBuffer, x: number, y: number, time: number): boolean {
  if (time - buffer.lastTime < RIPPLE_MIN_GAP) return false
  if (Math.hypot(x - buffer.lastX, y - buffer.lastY) < RIPPLE_MIN_TRAVEL) return false
  buffer.data.set([x, y, time], buffer.next * 3)
  buffer.next = (buffer.next + 1) % RIPPLE_COUNT
  buffer.lastX = x
  buffer.lastY = y
  buffer.lastTime = time
  return true
}
