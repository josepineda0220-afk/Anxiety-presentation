import { AnimatePresence, useIsPresent } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { useDeck } from './deckStore'
import { TextBoxView } from './TextBox'
import './deck.css'

/** The text boxes over the stage. Each slide has its own, and they crossfade with the brain. */
export function TextLayer() {
  const slide = useDeck((s) => s.slide)
  const inputMode = useDeck((s) => s.inputMode)
  return (
    <div
      className="text-layer"
      data-input={inputMode || undefined}
      onPointerDown={(event) => {
        // A press on empty space, not on a box, clears the selection.
        if (!(event.target as Element).closest('.tb')) useDeck.getState().select(null)
      }}
    >
      <AnimatePresence initial={false}>
        <SlideText key={slide} slide={slide} />
      </AnimatePresence>
    </div>
  )
}

function SlideText({ slide }: { slide: string }) {
  const boxes = useDeck(useShallow((s) => s.boxes.filter((box) => box.slide === slide)))
  const present = useIsPresent()
  // Each box fades itself. Fading this wrapper instead would cut frosted glass off from the stage
  // behind it for the length of the fade.
  return (
    <div className="text-slide" style={{ pointerEvents: present ? undefined : 'none' }}>
      {boxes.map((box) => (
        <TextBoxView key={box.id} box={box} />
      ))}
    </div>
  )
}
