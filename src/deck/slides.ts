import type { Focus } from '../brain/regions'
import { useStage } from '../stage/focusStore'
import { useDeck } from './deckStore'

export interface Slide {
  id: string
  focus: Focus
}

/** Number keys pick a slide. Each one points the brain at something and has its own text boxes. */
export const SLIDES: Slide[] = [
  { id: '1', focus: { regions: [], circuits: [] } },
  { id: '2', focus: { regions: ['amygdala'], circuits: [] } },
  { id: '3', focus: { regions: [], circuits: ['cstc'] } },
  { id: '4', focus: { regions: ['amygdala'], circuits: ['cstc'] } },
]

export function goToSlide(id: string) {
  const slide = SLIDES.find((s) => s.id === id)
  if (!slide) return
  useStage.getState().setFocus(slide.focus)
  useDeck.getState().setSlide(slide.id)
}
