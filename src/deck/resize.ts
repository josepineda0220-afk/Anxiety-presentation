/** The handles on a selected box: its right edge, its bottom edge, and the corner between them. */
export type ResizeHandle = 'width' | 'height' | 'both'

/** The narrowest a box can be dragged, in stage units. */
export const MIN_WIDTH = 8

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

interface Drag {
  handle: ResizeHandle
  /** The box when the drag started, in pixels. */
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  dx: number
  dy: number
  /** Pixels in one stage unit. */
  unit: number
  screen: { width: number; height: number }
}

/**
 * The size a drag asks for, in stage units, keeping the box on screen. A handle only sets the sides
 * it controls. Height has no minimum here: the box is drawn at least tall enough for its text, so
 * dragging up simply stops there.
 */
export function dragSize({ handle, rect, dx, dy, unit, screen }: Drag): { width?: number; height?: number } {
  const size: { width?: number; height?: number } = {}
  if (handle !== 'height') size.width = clamp(rect.width + dx, MIN_WIDTH * unit, screen.width - rect.left) / unit
  if (handle !== 'width') size.height = clamp(rect.height + dy, 0, screen.height - rect.top) / unit
  return size
}

/** What a double-click on a handle clears, so the box fits its text again on those sides. */
export function fitSize(handle: ResizeHandle): { width?: undefined; height?: undefined } {
  return {
    ...(handle !== 'height' && { width: undefined }),
    ...(handle !== 'width' && { height: undefined }),
  }
}
