import { describe, expect, it } from 'vitest'
import { dragSize, fitSize, MIN_WIDTH } from './resize'

const drag = {
  rect: { left: 100, top: 100, width: 400, height: 200 },
  unit: 10,
  screen: { width: 1000, height: 600 },
}

describe('dragging a resize handle', () => {
  it('changes only the side that handle controls', () => {
    expect(dragSize({ ...drag, handle: 'width', dx: 50, dy: 80 })).toEqual({ width: 45 })
    expect(dragSize({ ...drag, handle: 'height', dx: 50, dy: 80 })).toEqual({ height: 28 })
  })

  it('changes both sides from the corner', () => {
    expect(dragSize({ ...drag, handle: 'both', dx: 50, dy: 80 })).toEqual({ width: 45, height: 28 })
  })

  it('keeps the box on screen', () => {
    expect(dragSize({ ...drag, handle: 'both', dx: 5000, dy: 5000 })).toEqual({ width: 90, height: 50 })
  })

  it('stops at the narrowest width, and leaves the shortest height to the text', () => {
    expect(dragSize({ ...drag, handle: 'both', dx: -5000, dy: -5000 })).toEqual({ width: MIN_WIDTH, height: 0 })
  })
})

describe('double-clicking a resize handle', () => {
  it('clears only the sides that handle controls', () => {
    expect(Object.keys(fitSize('width'))).toEqual(['width'])
    expect(Object.keys(fitSize('height'))).toEqual(['height'])
    expect(Object.keys(fitSize('both')).sort()).toEqual(['height', 'width'])
  })
})
