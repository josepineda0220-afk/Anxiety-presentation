import { MEDICATION_SLIDES } from '../data/medications'
import {
  DEFAULT_BRAIN_SIDE,
  DEFAULT_CURSOR_EFFECT,
  DEFAULT_PARTICLE_STYLE,
  type BackdropTheme,
  type CursorEffect,
  type ParticleStyle,
  type Section,
  type SlideSpec,
} from '../data/sections'
import { useStage } from '../stage/focusStore'
import { useDeck } from './deckStore'

export const SLIDES = MEDICATION_SLIDES

export interface DeckSlide extends SlideSpec {
  sectionId: string
  sectionTitle: string
  backdrop: BackdropTheme
  cursorEffect: CursorEffect
  particles: ParticleStyle
}

/** Flattens every section's slides in presentation order. */
export function getAllSlides(sections: Section[] = useDeck.getState().sections): DeckSlide[] {
  return sections.flatMap((section) =>
    section.slides.map((slide) => ({
      ...slide,
      sectionId: section.id,
      sectionTitle: section.title,
      backdrop: section.backdrop,
      cursorEffect: section.cursorEffect ?? DEFAULT_CURSOR_EFFECT,
      particles: section.particles ?? DEFAULT_PARTICLE_STYLE,
    })),
  )
}

export function goToSlide(id: string) {
  const slide = getAllSlides().find((s) => s.id === id)
  if (!slide) return
  useStage.getState().setFocus(slide.focus)
  useStage.getState().setSide(slide.side ?? DEFAULT_BRAIN_SIDE)
  useStage.getState().setBackdrop(slide.backdrop)
  useStage.getState().setCursorEffect(slide.cursorEffect)
  useStage.getState().setParticles(slide.particles)
  // A new slide takes the brain back from anyone who was turning it by hand.
  useStage.getState().setExplore(false)
  useDeck.getState().setSlide(slide.id)
}

/** Jumps to the first slide of a section by its id or 1-based section number. */
export function goToSection(target: string | number) {
  const { sections } = useDeck.getState()
  const section =
    typeof target === 'number'
      ? sections[target - 1]
      : sections.find((s) => s.id === target) ?? sections[Number(target) - 1]
  const firstSlide = section?.slides[0]
  if (firstSlide) goToSlide(firstSlide.id)
}

/** Moves forward or back through every slide across all sections, stopping at either end. */
export function stepSlide(by: 1 | -1) {
  const all = getAllSlides()
  const index = all.findIndex((s) => s.id === useDeck.getState().slide)
  const next = all[index + by]
  if (next) goToSlide(next.id)
}
