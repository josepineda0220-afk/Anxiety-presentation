import { describe, expect, it } from 'vitest'
import {
  RIPPLE_COUNT,
  createRippleBuffer,
  createTapDetector,
  pinchToExplode,
  pushRipple,
  wheelToExplode,
} from './gestures'

describe('double tap', () => {
  it('needs two taps close together in time and place', () => {
    const taps = createTapDetector()
    expect(taps.tap({ x: 100, y: 100, time: 0 })).toBe(false)
    expect(taps.tap({ x: 108, y: 96, time: 200 })).toBe(true)
  })

  it('ignores a second tap that is too late or too far away', () => {
    const slow = createTapDetector()
    slow.tap({ x: 100, y: 100, time: 0 })
    expect(slow.tap({ x: 100, y: 100, time: 600 })).toBe(false)
    // The late tap counts as the first of a new pair.
    expect(slow.tap({ x: 100, y: 100, time: 800 })).toBe(true)

    const far = createTapDetector()
    far.tap({ x: 100, y: 100, time: 0 })
    expect(far.tap({ x: 220, y: 100, time: 150 })).toBe(false)
  })

  it('does not turn three quick taps into two double taps', () => {
    const taps = createTapDetector()
    taps.tap({ x: 0, y: 0, time: 0 })
    expect(taps.tap({ x: 0, y: 0, time: 100 })).toBe(true)
    expect(taps.tap({ x: 0, y: 0, time: 200 })).toBe(false)
  })

  it('forgets the first tap when reset', () => {
    const taps = createTapDetector()
    taps.tap({ x: 0, y: 0, time: 0 })
    taps.reset()
    expect(taps.tap({ x: 0, y: 0, time: 100 })).toBe(false)
  })
})

describe('pulling the brain apart', () => {
  it('opens gradually as the fingers spread and closes as they come together', () => {
    const a = pinchToExplode(0, 1.1)
    const b = pinchToExplode(a, 1.1)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(pinchToExplode(b, 0.9)).toBeLessThan(b)
  })

  it('stays between whole and fully apart', () => {
    expect(pinchToExplode(0.9, 4)).toBe(1)
    expect(pinchToExplode(0.1, 0.2)).toBe(0)
    expect(pinchToExplode(0.4, Number.NaN)).toBe(0.4)
    expect(wheelToExplode(0.5, -1000)).toBe(1)
    expect(wheelToExplode(0.5, 1000)).toBe(0)
  })

  it('treats a trackpad pinch out, which scrolls up, as opening', () => {
    expect(wheelToExplode(0.2, -10)).toBeGreaterThan(0.2)
  })
})

describe('cursor ripples', () => {
  it('drops a ring only after the cursor has moved on and a moment has passed', () => {
    const buffer = createRippleBuffer()
    expect(pushRipple(buffer, 0, 0, 10)).toBe(true)
    expect(pushRipple(buffer, 0.5, 0, 10.02)).toBe(false) // too soon
    expect(pushRipple(buffer, 0.01, 0, 11)).toBe(false) // has not moved
    expect(pushRipple(buffer, 0.5, 0, 11)).toBe(true)
    expect([...buffer.data.slice(0, 6)]).toEqual([0, 0, 10, 0.5, 0, 11])
  })

  it('reuses the oldest slot once every slot is taken', () => {
    const buffer = createRippleBuffer()
    for (let i = 0; i <= RIPPLE_COUNT; i++) pushRipple(buffer, i, 0, i)
    expect(buffer.data[0]).toBe(RIPPLE_COUNT)
    expect(buffer.data[3]).toBe(1)
  })
})
