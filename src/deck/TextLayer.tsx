import { useContext, useEffect, useState } from 'react'
import { AnimatePresence, useIsPresent } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { useStage } from '../stage/focusStore'
import { useDeck } from './deckStore'
import { finishEditing, TextBoxView } from './TextBox'
import { DEFAULT_BRAIN_SIDE } from '../data/sections'
import { BrainSideContext } from './textSide'
import './deck.css'

/**
 * The brain's side, a couple of frames late, so a slide coming in is first drawn where its text
 * waits before following the brain in.
 */
function useShownSide() {
  const side = useStage((s) => s.side)
  const [shown, setShown] = useState(side)
  useEffect(() => {
    if (shown === side) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(side))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [side, shown])
  return shown
}

/** The text boxes over the stage. Each slide has its own, and they crossfade with the brain. */
export function TextLayer() {
  const slide = useDeck((s) => s.slide)
  const inputMode = useDeck((s) => s.inputMode)
  const side = useShownSide()
  return (
    <BrainSideContext.Provider value={side}>
      <div
        className="text-layer"
        data-input={inputMode || undefined}
        onPointerDown={(event) => {
          const target = event.target as Element
          // A press anywhere outside the box being typed in ends the typing. A mouse does this by
          // taking focus away; a tap on a touch screen does not, so it is done here.
          if (useDeck.getState().editingId && !target.closest('.tb[data-editing]')) finishEditing()
          // A press on empty space, not on a box, clears the selection.
          if (!target.closest('.tb')) useDeck.getState().select(null)
        }}
      >
        <AnimatePresence initial={false}>
          <SlideText key={slide} slide={slide} />
        </AnimatePresence>
      </div>
    </BrainSideContext.Provider>
  )
}

/** How far, in screen widths, text travels with the brain when it changes side between slides. */
const GLIDE = 0.3

function SlideText({ slide }: { slide: string }) {
  const boxes = useDeck(useShallow((s) => s.boxes.filter((box) => box.slide === slide)))
  const side = useDeck(
    (s) => s.sections.flatMap((sec) => sec.slides).find((sl) => sl.id === slide)?.side ?? DEFAULT_BRAIN_SIDE,
  )
  const shownSide = useContext(BrainSideContext)
  const present = useIsPresent()

  // Arriving while the brain is still on the other side, this slide's text waits off toward the
  // brain's new side, then follows it in. Leaving, it moves off the same way, ahead of the brain.
  // Text never crosses the brain. A slide that is already showing just stays put.
  const [arrived, setArrived] = useState(side === shownSide)
  useEffect(() => {
    if (side === shownSide) setArrived(true)
  }, [side, shownSide])
  const travelling = (!present || !arrived) && side !== shownSide
  const offset = travelling ? (shownSide === 'left' ? -GLIDE : GLIDE) : 0

  // Each box fades itself. Fading this wrapper instead would cut frosted glass off from the stage
  // behind it for the length of the fade.
  return (
    <div
      className="text-slide"
      style={{ pointerEvents: present ? undefined : 'none', translate: `${(offset * 100).toFixed(1)}vw 0` }}
    >
      {boxes.map((box) => (
        <TextBoxView key={box.id} box={box} />
      ))}
    </div>
  )
}

/**
 * How far, in screen widths, to move a slide's text so it sits mirrored on the other side of the
 * screen: the group's left margin becomes its right margin. The boxes move together, so their
 * layout and reading order stay as they are.
 */
export function mirrorShift(slideId: string): number {
  const ids = new Set(useDeck.getState().boxes.filter((box) => box.slide === slideId).map((box) => box.id))
  const width = window.innerWidth
  let left = Infinity
  let right = -Infinity
  for (const element of document.querySelectorAll<HTMLElement>('.tb[data-box-id]')) {
    if (!ids.has(element.dataset.boxId!)) continue
    left = Math.min(left, element.offsetLeft)
    right = Math.max(right, element.offsetLeft + element.offsetWidth)
  }
  return left === Infinity ? 0 : (width - right - left) / width
}
