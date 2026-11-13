import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { IDLE_FOCUS } from '../brain/regions'
import { SEED_BOXES } from '../data/medications'
import {
  ALL_SEED_BOXES,
  DEFAULT_CURSOR_EFFECT,
  NON_MEDICATION_SEED_BOXES,
  SEED_SECTIONS,
  makeTemplateSlideBoxes,
  type BackdropTheme,
  type CursorEffect,
  type Section,
  type SlideSpec,
} from '../data/sections'
import { useStage } from '../stage/focusStore'
import { verifyEditPassword } from '../sync/crypto'
import { isCloudConfigured } from '../sync/config'

export type TextStyle = 'title' | 'heading' | 'body' | 'small'
export type TextColor = 'white' | 'grey' | 'black'
export type BoxLook = 'clear' | 'frosted'

export interface TextFormat {
  style: TextStyle
  color: TextColor
  look: BoxLook
}

export interface TextBox extends TextFormat {
  id: string
  /** The slide this box belongs to. */
  slide: string
  text: string
  /** Left edge, as a fraction of the screen width. */
  x: number
  /** Top edge, as a fraction of the screen height. */
  y: number
  /** Width in stage units (--u in deck.css). Left out, the box grows with its text up to a limit. */
  width?: number
  /** Least height in stage units. Longer text still makes the box taller. Left out, it fits the text. */
  height?: number
}

/** What a new box says before anything is typed. It starts selected, so typing replaces it. */
export const STARTER_TEXT: Record<TextStyle, string> = {
  title: 'Title',
  heading: 'Heading',
  body: 'Body text',
  small: 'Small text',
}

interface DeckState {
  slide: string
  sections: Section[]
  inputMode: boolean
  unlocked: boolean
  promptingPassword: boolean
  selectedId: string | null
  editingId: string | null
  boxes: TextBox[]
  /** Format for the next new box: the last one picked. */
  format: TextFormat
  setSlide: (slide: string) => void
  setInputMode: (on: boolean) => void
  /** Opens Input Mode if already unlocked, or opens the password gate modal. */
  requestInputMode: () => void
  cancelPasswordPrompt: () => void
  unlockWithPassword: (password: string) => Promise<boolean>
  lockInputMode: () => void
  replaceDeckFromCloud: (payload: { sections: Section[]; boxes: TextBox[]; format: TextFormat }) => void
  addBox: () => void
  updateBox: (id: string, patch: Partial<Omit<TextBox, 'id' | 'slide'>>) => void
  removeBox: (id: string) => void
  select: (id: string | null) => void
  startEditing: (id: string) => void
  stopEditing: () => void
  /** Restyles the selected box, if any, and makes this the format for new boxes. */
  applyFormat: (patch: Partial<TextFormat>) => void
  /** Sets the background color theme for a section and updates the stage if active. */
  setSectionBackdrop: (sectionId: string, backdrop: BackdropTheme) => void
  /** Sets what the background does around the cursor in a section, and updates the stage if active. */
  setSectionCursorEffect: (sectionId: string, cursorEffect: CursorEffect) => void
  /** Renames a section title. */
  renameSection: (sectionId: string, title: string) => void
  /** Appends a new section with starter template boxes and switches to it. */
  addSection: (title?: string) => Section
  /** Removes a section and its slides/boxes (when more than one section exists). */
  removeSection: (sectionId: string) => void
  /** Adds a new template slide to a section (defaults to the active section) and switches to it. */
  addSlide: (sectionId?: string) => SlideSpec | null
  /** Removes a slide from its section (when the section has more than one slide). */
  removeSlide: (slideId?: string) => void
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * Where the next box on a slide goes: the open column left of the brain, stepping down so new
 * boxes never land exactly on top of each other.
 */
export function placeNewBox(boxesOnSlide: number): { x: number; y: number } {
  const step = boxesOnSlide % 6
  return { x: 0.07 + step * 0.012, y: 0.14 + step * 0.11 }
}

/** When editing ends, trailing blank lines go, and a box left with no text is removed. */
function finishEditing(state: DeckState): Partial<DeckState> {
  const id = state.editingId
  if (!id) return {}
  const box = state.boxes.find((b) => b.id === id)
  const text = box?.text.replace(/\s+$/, '') ?? ''
  if (!text) {
    return {
      editingId: null,
      selectedId: state.selectedId === id ? null : state.selectedId,
      boxes: state.boxes.filter((b) => b.id !== id),
    }
  }
  return {
    editingId: null,
    boxes: text === box?.text ? state.boxes : state.boxes.map((b) => (b.id === id ? { ...b, text } : b)),
  }
}

/** Gives the stage a section's background colour and cursor effect. */
function showSectionOnStage(section: Pick<Section, 'backdrop' | 'cursorEffect'>) {
  useStage.getState().setBackdrop(section.backdrop)
  useStage.getState().setCursorEffect(section.cursorEffect ?? DEFAULT_CURSOR_EFFECT)
}

function findSectionForSlide(sections: Section[], slideId: string): Section | undefined {
  return sections.find((sec) => sec.slides.some((sl) => sl.id === slideId))
}

export const useDeck = create<DeckState>()(
  persist(
    (set, get) => ({
      slide: SEED_SECTIONS[0].slides[0].id,
      sections: SEED_SECTIONS,
      inputMode: false,
      unlocked: false,
      promptingPassword: false,
      selectedId: null,
      editingId: null,
      boxes: ALL_SEED_BOXES,
      format: { style: 'body', color: 'white', look: 'clear' },

      setSlide: (slide) =>
        set((s) => (s.slide === slide ? {} : { ...finishEditing(s), slide, selectedId: null })),

      setInputMode: (on) =>
        set((s) => (on ? { inputMode: true } : { ...finishEditing(s), inputMode: false, selectedId: null })),

      requestInputMode: () =>
        set((s) => (s.unlocked ? { inputMode: true, promptingPassword: false } : { promptingPassword: true })),

      cancelPasswordPrompt: () => set({ promptingPassword: false }),

      unlockWithPassword: async (password) => {
        // With Firebase, the password signs in to the shared editor account that Firestore rules let write.
        const valid = isCloudConfigured()
          ? await (await import('../sync/firebase')).signInEditor(password.trim())
          : await verifyEditPassword(password)
        if (!valid) return false
        set({
          unlocked: true,
          promptingPassword: false,
          inputMode: true,
        })
        return true
      },

      lockInputMode: () => {
        set((s) => ({
          ...finishEditing(s),
          unlocked: false,
          promptingPassword: false,
          inputMode: false,
          selectedId: null,
        }))
        if (isCloudConfigured()) void import('../sync/firebase').then((m) => m.signOutEditor())
      },

      replaceDeckFromCloud: ({ sections, boxes, format }) =>
        set((s) => {
          if (sections.length === 0) return {}
          const allSlides = sections.flatMap((sec) => sec.slides.map((sl) => ({ ...sl, section: sec })))
          const activeSlide = allSlides.find((sl) => sl.id === s.slide) ?? allSlides[0]
          if (activeSlide) {
            useStage.getState().setFocus(activeSlide.focus)
            showSectionOnStage(activeSlide.section)
          }
          return {
            sections,
            boxes,
            format: format ?? s.format,
            slide: activeSlide ? activeSlide.id : s.slide,
          }
        }),

      addBox: () =>
        set((s) => {
          const boxes = finishEditing(s).boxes ?? s.boxes
          const onSlide = boxes.filter((b) => b.slide === s.slide).length
          const box: TextBox = {
            id: newId(),
            slide: s.slide,
            text: STARTER_TEXT[s.format.style],
            ...placeNewBox(onSlide),
            ...s.format,
          }
          return { boxes: [...boxes, box], selectedId: box.id, editingId: box.id }
        }),

      updateBox: (id, patch) =>
        set((s) => ({ boxes: s.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),

      removeBox: (id) =>
        set((s) => ({
          boxes: s.boxes.filter((b) => b.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
          editingId: s.editingId === id ? null : s.editingId,
        })),

      select: (id) =>
        set((s) => ({ ...(s.editingId && s.editingId !== id ? finishEditing(s) : {}), selectedId: id })),

      startEditing: (id) =>
        set((s) => (s.editingId === id ? {} : { ...finishEditing(s), selectedId: id, editingId: id })),

      stopEditing: () => set((s) => finishEditing(s)),

      applyFormat: (patch) =>
        set((s) => {
          const selected = s.boxes.find((b) => b.id === s.selectedId)
          if (!selected) return { format: { ...s.format, ...patch } }
          const { style, color, look } = { ...selected, ...patch }
          return {
            format: { style, color, look },
            boxes: s.boxes.map((b) => (b === selected ? { ...b, style, color, look } : b)),
          }
        }),

      setSectionBackdrop: (sectionId, backdrop) =>
        set((s) => {
          const sections = s.sections.map((sec) => (sec.id === sectionId ? { ...sec, backdrop } : sec))
          const activeSec = findSectionForSlide(sections, s.slide)
          if (activeSec?.id === sectionId) showSectionOnStage(activeSec)
          return { sections }
        }),

      setSectionCursorEffect: (sectionId, cursorEffect) =>
        set((s) => {
          const sections = s.sections.map((sec) => (sec.id === sectionId ? { ...sec, cursorEffect } : sec))
          const activeSec = findSectionForSlide(sections, s.slide)
          if (activeSec?.id === sectionId) showSectionOnStage(activeSec)
          return { sections }
        }),

      renameSection: (sectionId, title) =>
        set((s) => {
          const trimmed = title.trim()
          if (!trimmed) return {}
          return {
            sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, title: trimmed } : sec)),
          }
        }),

      addSection: (customTitle) => {
        const s = get()
        const cleaned = finishEditing(s)
        const baseBoxes = cleaned.boxes ?? s.boxes
        const activeSec = findSectionForSlide(s.sections, s.slide)
        const backdrop: BackdropTheme = activeSec?.backdrop ?? 'blue'
        const sectionTitle = customTitle?.trim() || `New Section ${s.sections.length + 1}`
        const sectionId = `sec-${newId()}`
        const slideId = `slide-${newId()}`
        const slideSpec: SlideSpec = {
          id: slideId,
          title: `${sectionTitle} — Overview`,
          focus: IDLE_FOCUS,
        }
        const newSection: Section = {
          id: sectionId,
          title: sectionTitle,
          backdrop,
          ...(activeSec?.cursorEffect ? { cursorEffect: activeSec.cursorEffect } : {}),
          slides: [slideSpec],
        }
        const templateBoxes: TextBox[] = makeTemplateSlideBoxes(sectionTitle, 'Overview & key points').map((box) => ({
          ...box,
          id: newId(),
          slide: slideId,
        }))

        set({
          ...cleaned,
          sections: [...s.sections, newSection],
          boxes: [...baseBoxes, ...templateBoxes],
          slide: slideId,
          selectedId: null,
          editingId: null,
        })
        useStage.getState().setFocus(slideSpec.focus)
        showSectionOnStage(newSection)
        return newSection
      },

      removeSection: (sectionId) =>
        set((s) => {
          if (s.sections.length <= 1) return {}
          const index = s.sections.findIndex((sec) => sec.id === sectionId)
          if (index === -1) return {}
          const removed = s.sections[index]
          const removedSlideIds = new Set(removed.slides.map((sl) => sl.id))
          const cleaned = finishEditing(s)
          const baseBoxes = cleaned.boxes ?? s.boxes
          const sections = s.sections.filter((sec) => sec.id !== sectionId)
          const boxes = baseBoxes.filter((b) => !removedSlideIds.has(b.slide))

          if (removedSlideIds.has(s.slide)) {
            const nextSection = sections[Math.min(index, sections.length - 1)]
            const nextSlide = nextSection.slides[0]
            useStage.getState().setFocus(nextSlide.focus)
            showSectionOnStage(nextSection)
            return {
              ...cleaned,
              sections,
              boxes,
              slide: nextSlide.id,
              selectedId: null,
              editingId: null,
            }
          }

          return { ...cleaned, sections, boxes }
        }),

      addSlide: (sectionId) => {
        const s = get()
        const cleaned = finishEditing(s)
        const baseBoxes = cleaned.boxes ?? s.boxes
        const targetSec = sectionId
          ? s.sections.find((sec) => sec.id === sectionId)
          : findSectionForSlide(s.sections, s.slide)
        if (!targetSec) return null

        const slideNumber = targetSec.slides.length + 1
        const slideId = `slide-${newId()}`
        const newSlide: SlideSpec = {
          id: slideId,
          title: `${targetSec.title} (${slideNumber})`,
          focus: IDLE_FOCUS,
        }
        const templateBoxes: TextBox[] = makeTemplateSlideBoxes(
          targetSec.title,
          `Subtopic ${slideNumber}`,
        ).map((box) => ({
          ...box,
          id: newId(),
          slide: slideId,
        }))

        const sections = s.sections.map((sec) =>
          sec.id === targetSec.id ? { ...sec, slides: [...sec.slides, newSlide] } : sec,
        )

        set({
          ...cleaned,
          sections,
          boxes: [...baseBoxes, ...templateBoxes],
          slide: slideId,
          selectedId: null,
          editingId: null,
        })
        useStage.getState().setFocus(newSlide.focus)
        showSectionOnStage(targetSec)
        return newSlide
      },

      removeSlide: (slideId) =>
        set((s) => {
          const targetSlideId = slideId ?? s.slide
          const section = findSectionForSlide(s.sections, targetSlideId)
          if (!section || section.slides.length <= 1) return {}

          const slideIndex = section.slides.findIndex((sl) => sl.id === targetSlideId)
          const remainingSlides = section.slides.filter((sl) => sl.id !== targetSlideId)
          const cleaned = finishEditing(s)
          const baseBoxes = cleaned.boxes ?? s.boxes
          const boxes = baseBoxes.filter((b) => b.slide !== targetSlideId)
          const sections = s.sections.map((sec) =>
            sec.id === section.id ? { ...sec, slides: remainingSlides } : sec,
          )

          if (s.slide === targetSlideId) {
            const nextSlide = remainingSlides[Math.min(slideIndex, remainingSlides.length - 1)]
            useStage.getState().setFocus(nextSlide.focus)
            showSectionOnStage(section)
            return {
              ...cleaned,
              sections,
              boxes,
              slide: nextSlide.id,
              selectedId: null,
              editingId: null,
            }
          }

          return { ...cleaned, sections, boxes }
        }),
    }),
    {
      name: 'anxiety-presentation:deck',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // Browsers that saved boxes in earlier versions keep them and gain the full presentation sections.
      migrate: (saved, version) => {
        const state = saved as Partial<Pick<DeckState, 'sections' | 'boxes' | 'format'>>
        let boxes = state.boxes ?? []
        if (version < 2) {
          boxes = [...boxes, ...SEED_BOXES]
        }
        if (version < 3) {
          const existingIds = new Set(boxes.map((b) => b.id))
          boxes = [...boxes, ...NON_MEDICATION_SEED_BOXES.filter((b) => !existingIds.has(b.id))]
        }
        return {
          ...state,
          sections: state.sections ?? SEED_SECTIONS,
          boxes,
        }
      },
      // Only the sections and slides' content are kept. Where you are and what is selected start fresh.
      partialize: (s) => ({
        sections: s.sections,
        boxes: s.boxes.filter((b) => b.text.trim()),
        format: s.format,
      }),
    },
  ),
)
