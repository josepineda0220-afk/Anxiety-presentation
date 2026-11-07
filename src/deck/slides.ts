import { MEDICATION_SLIDES } from '../data/medications'
import { useStage } from '../stage/focusStore'
import { useDeck } from './deckStore'

/** Each slide points the brain at something and has its own text boxes. */
export const SLIDES = MEDICATION_SLIDES

export function goToSlide(id: string) {
  const slide = SLIDES.find((s) => s.id === id)
  if (!slide) return
  useStage.getState().setFocus(slide.focus)
  useDeck.getState().setSlide(slide.id)
}

/** Moves forward or back through the slides, stopping at either end. */
export function stepSlide(by: 1 | -1) {
  const index = SLIDES.findIndex((s) => s.id === useDeck.getState().slide)
  const next = SLIDES[index + by]
  if (next) goToSlide(next.id)
}
