import { useEffect } from 'react'
import { useStage } from './focusStore'
import { createTapDetector, pinchToExplode, pushRipple, wheelToExplode } from './gestures'
import { interaction, interactionTime } from './interaction'

/** Radians the brain turns for each pixel dragged, and for each pixel of wheel scroll. */
const DRAG_TURN = 0.0085
const WHEEL_TURN = 0.0045
/** A press that travels further than this is a drag, not a tap. */
const TAP_TRAVEL = 10
const TAP_MS = 450

/** Text boxes, toolbars and dialogs keep their own clicks, drags and double clicks. */
const UI = '.tb, .toolbar, .password-backdrop, button, input, textarea, select, a, [contenteditable="true"]'
const onUi = (target: EventTarget | null) => target instanceof Element && target.closest(UI) !== null

interface Press {
  x: number
  y: number
  startX: number
  startY: number
  time: number
  moved: boolean
}

/**
 * Pointer handling for the whole stage, in presenting and input mode alike.
 *
 * Any pointer movement feeds the background's cursor effect. A double tap on the brain hands it
 * to the viewer: scrolling or dragging turns it, pinching out pulls its parts apart. Another
 * double tap hands it back to the slide.
 *
 * It listens on the window because in input mode the text layer lies over the canvas.
 */
export function useStageGestures() {
  useEffect(() => {
    const taps = createTapDetector()
    const presses = new Map<number, Press>()
    let pinchSpread = 0
    let safariScale = 1

    const exploring = () => useStage.getState().explore

    const trackPointer = (event: PointerEvent) => {
      const { innerWidth: w, innerHeight: h } = window
      const p = interaction.pointer
      p.x = (event.clientX / w) * 2 - 1
      p.y = 1 - (event.clientY / h) * 2
      p.movedAt = interactionTime()
      p.present = true
      pushRipple(interaction.ripples, p.x * (w / h), p.y, p.movedAt)
    }

    const spread = () => {
      const [a, b] = [...presses.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    const setExplore = (on: boolean) => {
      if (on) interaction.explore.explode = 0
      interaction.explore.turnX = 0
      interaction.explore.turnY = 0
      useStage.getState().setExplore(on)
    }

    const onBrain = (x: number, y: number) => {
      const brain = interaction.brainOnScreen
      return brain.radius > 0 && Math.hypot(x - brain.x, y - brain.y) <= brain.radius
    }

    const onPointerDown = (event: PointerEvent) => {
      trackPointer(event)
      if (onUi(event.target) || (event.pointerType === 'mouse' && event.button !== 0)) return
      presses.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        time: event.timeStamp,
        moved: false,
      })
      if (presses.size === 2) pinchSpread = spread()
      // More than one finger down is a pinch, never a tap.
      if (presses.size > 1) {
        taps.reset()
        for (const press of presses.values()) press.moved = true
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      trackPointer(event)
      const press = presses.get(event.pointerId)
      if (!press) return
      const dx = event.clientX - press.x
      const dy = event.clientY - press.y
      press.x = event.clientX
      press.y = event.clientY
      if (Math.hypot(press.x - press.startX, press.y - press.startY) > TAP_TRAVEL) press.moved = true
      if (!exploring()) return

      if (presses.size === 1 && press.moved) {
        interaction.explore.turnX += dx * DRAG_TURN
        interaction.explore.turnY += dy * DRAG_TURN
      } else if (presses.size === 2) {
        const now = spread()
        if (pinchSpread > 0) {
          interaction.explore.explode = pinchToExplode(interaction.explore.explode, now / pinchSpread)
        }
        pinchSpread = now
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      const press = presses.get(event.pointerId)
      presses.delete(event.pointerId)
      if (event.pointerType !== 'mouse') interaction.pointer.present = false
      if (!press || event.type === 'pointercancel') return
      if (press.moved || event.timeStamp - press.time > TAP_MS) {
        taps.reset()
        return
      }
      if (!taps.tap({ x: event.clientX, y: event.clientY, time: event.timeStamp })) return
      // The first double tap has to land on the brain. The one that hands it back can land anywhere.
      if (exploring()) setExplore(false)
      else if (onBrain(event.clientX, event.clientY)) setExplore(true)
    }

    const onWheel = (event: WheelEvent) => {
      if (!exploring() || onUi(event.target)) return
      event.preventDefault()
      // Lines or pages, from a classic mouse wheel, count for more than trackpad pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      if (event.ctrlKey) {
        // A trackpad pinch arrives as a wheel event with ctrl held.
        interaction.explore.explode = wheelToExplode(interaction.explore.explode, event.deltaY * unit)
      } else {
        // Shift turns a plain mouse wheel sideways, as it does for scrolling.
        const sideways = event.shiftKey && event.deltaX === 0
        // Scrolling moves the surface the way it would move a page.
        interaction.explore.turnX -= (sideways ? event.deltaY : event.deltaX) * unit * WHEEL_TURN
        interaction.explore.turnY -= (sideways ? 0 : event.deltaY) * unit * WHEEL_TURN
      }
    }

    // Safari reports a trackpad pinch with its own gesture events, each carrying the total scale.
    const onGestureStart = (event: Event) => {
      if (!exploring()) return
      event.preventDefault()
      safariScale = 1
    }
    const onGestureChange = (event: Event) => {
      if (!exploring()) return
      event.preventDefault()
      // On a touch screen the pointer events above already handle the pinch.
      if (presses.size > 0) return
      const scale = (event as Event & { scale?: number }).scale ?? 1
      interaction.explore.explode = pinchToExplode(interaction.explore.explode, scale / safariScale)
      safariScale = scale
    }

    const onLeave = () => {
      interaction.pointer.present = false
    }

    // The page must not scroll or zoom under a finger that is turning the brain.
    const unsubscribe = useStage.subscribe((state, previous) => {
      if (state.explore === previous.explore) return
      document.documentElement.toggleAttribute('data-explore', state.explore)
      if (!state.explore) taps.reset()
    })

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('gesturestart', onGestureStart, { passive: false })
    window.addEventListener('gesturechange', onGestureChange, { passive: false })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      unsubscribe()
      document.documentElement.removeAttribute('data-explore')
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('gesturestart', onGestureStart)
      window.removeEventListener('gesturechange', onGestureChange)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])
}
