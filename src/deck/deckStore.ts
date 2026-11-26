import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { IDLE_FOCUS } from '../brain/regions'
import {
  ALL_SEED_BOXES,
  DEFAULT_BRAIN_SIDE,
  DEFAULT_CURSOR_EFFECT,
  DEFAULT_PARTICLE_STYLE,
  SEED_SECTIONS,
  makeTemplateSlideBoxes,
  sectionLook,
  slideLook,
  type BackdropTheme,
  type BrainSide,
  type CursorEffect,
  type ParticleStyle,
  type Section,
  type SlideLook,
  type SlideSpec,
} from '../data/sections'
import { useStage } from '../stage/focusStore'
import { isEditingConfigured } from '../sync/config'
import type { SignInResult } from '../sync/firebase'
import { isSyncReady } from '../sync/syncStatus'
import { sameData, type PartData, type PartKind } from '../sync/schema'
import { charFormats, editFormats, pickFormat, shownFormat, withFormats, type CharFormat, type TextCursor } from './format'

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
  /** Stretches of the text in a size other than `style`; see format.ts. */
  sizes?: string
  /** Stretches of the text in a colour other than `color`. */
  colors?: string
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
  /** Signed in to the shared editor account on this tab. */
  unlocked: boolean
  promptingPassword: boolean
  selectedId: string | null
  editingId: string | null
  /** The caret or selection in the box being typed in. */
  textCursor: (TextCursor & { boxId: string }) | null
  boxes: TextBox[]
  /** Format for the next new box: the last one picked. */
  format: TextFormat
  setSlide: (slide: string) => void
  setInputMode: (on: boolean) => void
  /** Opens Input Mode if already unlocked, or opens the password gate modal. */
  requestInputMode: () => void
  cancelPasswordPrompt: () => void
  /** Signs in to the shared editor account. Input mode opens once the cloud deck has loaded. */
  unlockWithPassword: (password: string) => Promise<SignInResult>
  /** Follows the sign-in state, which can also change in another way (a reload, or the session ending). */
  setUnlocked: (unlocked: boolean) => void
  lockInputMode: () => void
  /** Someone else's change to one section or text box. Null removes it. */
  applyRemotePart: (kind: PartKind, id: string, data: PartData | null) => void
  /** The whole deck, as loaded or restored from the cloud. */
  replaceDeck: (deck: { sections: Section[]; boxes: TextBox[] }) => void
  /** Puts sections in this order; sections it leaves out keep their place after these. */
  orderSections: (order: string[]) => void
  addBox: () => void
  updateBox: (id: string, patch: Partial<Omit<TextBox, 'id' | 'slide'>>) => void
  removeBox: (id: string) => void
  select: (id: string | null) => void
  startEditing: (id: string) => void
  stopEditing: () => void
  /** What was typed into a box, and where the caret ended up. The formats follow the text. */
  typeText: (id: string, text: string, caret?: number) => void
  /** Follows the caret or selection in the box being typed in. */
  setTextCursor: (boxId: string, start: number, end: number) => void
  /**
   * Restyles the selected box, if any, and makes this the format for new boxes. While typing, a size
   * or colour goes to the selected text, or with nothing selected to what is typed next.
   */
  applyFormat: (patch: Partial<TextFormat>) => void
  /**
   * Gives one slide its own background colour, cursor effect or dot style. A choice that matches
   * its section's is not kept, so the slide follows the section again.
   */
  setSlideLook: (slideId: string, patch: Partial<SlideLook>) => void
  /** Makes a slide's look the look of every slide in its section. */
  applySlideLookToSection: (slideId: string) => void
  /** Moves a section to a new place in the deck (0 is first). */
  moveSection: (sectionId: string, toIndex: number) => void
  /** Sets the background color theme for a section and updates the stage if active. */
  setSectionBackdrop: (sectionId: string, backdrop: BackdropTheme) => void
  /** Sets what the background does around the cursor in a section, and updates the stage if active. */
  setSectionCursorEffect: (sectionId: string, cursorEffect: CursorEffect) => void
  /** Sets whether a section's dots are plain or sparkle, and updates the stage if active. */
  setSectionParticles: (sectionId: string, particles: ParticleStyle) => void
  /**
   * Puts a slide's brain on the left or right, and moves all its text boxes across by textShift
   * (a fraction of the screen width) to clear it.
   */
  setSlideSide: (slideId: string, side: BrainSide, textShift?: number) => void
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

/** The cursor in the selected box, while it is being typed in. */
function typingCursor(s: DeckState): TextCursor | null {
  return s.textCursor && s.editingId === s.selectedId && s.textCursor.boxId === s.selectedId ? s.textCursor : null
}

/**
 * The size or colour the toolbar shows as on: that of the selected text or of what is typed next,
 * and none when the selected text mixes them. With no box selected, the next box's.
 */
export function shownTextFormat<K extends keyof CharFormat>(s: DeckState, key: K): CharFormat[K] | undefined {
  const box = s.boxes.find((b) => b.id === s.selectedId)
  return box ? shownFormat(box, typingCursor(s))[key] : s.format[key]
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
  const trim = (b: TextBox): TextBox => ({ ...b, text, ...withFormats(text, b, charFormats(b)) })
  return {
    editingId: null,
    boxes: text === box?.text ? state.boxes : state.boxes.map((b) => (b.id === id ? trim(b) : b)),
  }
}

/** Gives the stage a slide's background colour, cursor effect and dot style. */
function showLookOnStage(look: SlideLook) {
  const stage = useStage.getState()
  if (stage.backdrop !== look.backdrop) stage.setBackdrop(look.backdrop)
  if (stage.cursorEffect !== look.cursorEffect) stage.setCursorEffect(look.cursorEffect)
  if (stage.particles !== look.particles) stage.setParticles(look.particles)
}

/** After a section or slide look changed: the stage shows the current slide's. */
function showCurrentLook(sections: Section[], slideId: string) {
  const section = findSectionForSlide(sections, slideId)
  if (section) showLookOnStage(slideLook(section, section.slides.find((sl) => sl.id === slideId)))
}

/** A look as a section keeps it: options at their default are left out. */
function sectionDefaults(look: SlideLook): Pick<Section, 'backdrop' | 'cursorEffect' | 'particles'> {
  return {
    backdrop: look.backdrop,
    ...(look.cursorEffect !== DEFAULT_CURSOR_EFFECT && { cursorEffect: look.cursorEffect }),
    ...(look.particles !== DEFAULT_PARTICLE_STYLE && { particles: look.particles }),
  }
}

/** A slide's own look choices, without any that match its section's. */
function withLook(slide: SlideSpec, look: Partial<SlideLook>, section: SlideLook): SlideSpec {
  const { backdrop: _b, cursorEffect: _c, particles: _p, ...rest } = slide
  const next: SlideSpec = { ...rest }
  const own = { backdrop: slide.backdrop, cursorEffect: slide.cursorEffect, particles: slide.particles, ...look }
  if (own.backdrop && own.backdrop !== section.backdrop) next.backdrop = own.backdrop
  if (own.cursorEffect && own.cursorEffect !== section.cursorEffect) next.cursorEffect = own.cursorEffect
  if (own.particles && own.particles !== section.particles) next.particles = own.particles
  return next
}

/** Gives the stage a slide's focus and the side its brain sits on. */
function showSlideOnStage(slide: SlideSpec) {
  useStage.getState().setFocus(slide.focus)
  useStage.getState().setSide(slide.side ?? DEFAULT_BRAIN_SIDE)
}

function findSectionForSlide(sections: Section[], slideId: string): Section | undefined {
  return sections.find((sec) => sec.slides.some((sl) => sl.id === slideId))
}

/**
 * After the sections changed underneath the presenter: keeps the current slide valid (staying in
 * its section when that slide went away) and the stage showing it.
 */
function settleSlide(state: DeckState, sections: Section[]): Partial<DeckState> {
  let section = findSectionForSlide(sections, state.slide)
  let slide = section?.slides.find((sl) => sl.id === state.slide)
  if (!section || !slide) {
    const previous = findSectionForSlide(state.sections, state.slide)
    section = sections.find((sec) => sec.id === previous?.id) ?? sections[0]
    slide = section?.slides[0]
  }
  if (!section || !slide) return { sections }
  const stage = useStage.getState()
  if (!sameData(stage.focus, slide.focus)) stage.setFocus(slide.focus)
  if (stage.side !== (slide.side ?? DEFAULT_BRAIN_SIDE)) stage.setSide(slide.side ?? DEFAULT_BRAIN_SIDE)
  showLookOnStage(slideLook(section, slide))
  if (slide.id === state.slide) return { sections }
  return { sections, slide: slide.id, selectedId: null, editingId: null }
}

/** Clears the selection and editing of a box that is gone. */
function forgetMissing(state: DeckState, boxes: TextBox[]): Partial<DeckState> {
  const has = (id: string | null) => id !== null && boxes.some((b) => b.id === id)
  return {
    boxes,
    ...(state.selectedId && !has(state.selectedId) && { selectedId: null }),
    ...(state.editingId && !has(state.editingId) && { editingId: null }),
  }
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
      textCursor: null,
      boxes: ALL_SEED_BOXES,
      format: { style: 'body', color: 'white', look: 'clear' },

      setSlide: (slide) =>
        set((s) => (s.slide === slide ? {} : { ...finishEditing(s), slide, selectedId: null })),

      setInputMode: (on) =>
        set((s) => (on ? { inputMode: true } : { ...finishEditing(s), inputMode: false, selectedId: null })),

      // Signed in and loaded: straight into input mode. Otherwise the gate asks for the password, or
      // waits for the cloud deck, so nothing is typed into a deck that is about to be replaced.
      requestInputMode: () =>
        set((s) => (s.unlocked && isSyncReady() ? { inputMode: true, promptingPassword: false } : { promptingPassword: true })),

      cancelPasswordPrompt: () => set({ promptingPassword: false }),

      unlockWithPassword: async (password) => {
        if (!isEditingConfigured()) return 'unavailable'
        const { signIn } = await import('../sync/cloudSync')
        const result = await signIn(password)
        if (result === 'ok') set({ unlocked: true })
        return result
      },

      setUnlocked: (unlocked) =>
        set((s) => {
          if (unlocked === s.unlocked) return {}
          if (unlocked) return { unlocked }
          return { ...finishEditing(s), unlocked, inputMode: false, selectedId: null }
        }),

      lockInputMode: () => {
        set((s) => ({
          ...finishEditing(s),
          unlocked: false,
          promptingPassword: false,
          inputMode: false,
          selectedId: null,
        }))
        if (isEditingConfigured()) void import('../sync/cloudSync').then((m) => m.signOut())
      },

      applyRemotePart: (kind, id, data) =>
        set((s) => {
          if (kind === 'box') {
            const box = data ? ({ id, ...data } as TextBox) : null
            const at = s.boxes.findIndex((b) => b.id === id)
            const boxes =
              box === null
                ? s.boxes.filter((b) => b.id !== id)
                : at === -1
                  ? [...s.boxes, box]
                  : s.boxes.map((b, i) => (i === at ? box : b))
            return forgetMissing(s, boxes)
          }
          const section = data ? ({ id, ...data } as Section) : null
          const at = s.sections.findIndex((sec) => sec.id === id)
          const sections =
            section === null
              ? s.sections.filter((sec) => sec.id !== id)
              : at === -1
                ? [...s.sections, section]
                : s.sections.map((sec, i) => (i === at ? section : sec))
          return sections.length === 0 ? {} : settleSlide(s, sections)
        }),

      replaceDeck: ({ sections, boxes }) =>
        set((s) => (sections.length === 0 ? {} : { ...settleSlide(s, sections), ...forgetMissing(s, boxes) })),

      orderSections: (order) =>
        set((s) => {
          const rank = new Map(order.map((id, i) => [id, i]))
          const sections = [...s.sections].sort(
            (a, b) => (rank.get(a.id) ?? order.length + s.sections.indexOf(a)) - (rank.get(b.id) ?? order.length + s.sections.indexOf(b)),
          )
          return sections.every((sec, i) => sec === s.sections[i]) ? {} : { sections }
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
          return { boxes: [...boxes, box], selectedId: box.id, editingId: box.id, textCursor: null }
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
        set((s) => (s.editingId === id ? {} : { ...finishEditing(s), selectedId: id, editingId: id, textCursor: null })),

      stopEditing: () => set((s) => finishEditing(s)),

      typeText: (id, text, caret) =>
        set((s) => {
          const cursor = s.textCursor?.boxId === id ? s.textCursor : undefined
          return {
            boxes: s.boxes.map((b) => (b.id === id ? { ...b, text, ...editFormats(b, text, { caret, cursor }) } : b)),
            textCursor: caret === undefined ? null : { boxId: id, start: caret, end: caret },
          }
        }),

      setTextCursor: (boxId, start, end) =>
        set((s) => {
          const at = s.textCursor
          // Staying put keeps a pick that is waiting for the next characters.
          if (at && at.boxId === boxId && at.start === start && at.end === end) return {}
          return { textCursor: { boxId, start, end } }
        }),

      applyFormat: (patch) =>
        set((s) => {
          const selected = s.boxes.find((b) => b.id === s.selectedId)
          if (!selected) return { format: { ...s.format, ...patch } }
          // The look belongs to the whole box; the size and colour to its text.
          const { look, ...pick } = patch
          let box: TextBox = look ? { ...selected, look } : selected
          const cursor = typingCursor(s)
          let textCursor = s.textCursor
          const picking = Object.keys(pick).length > 0
          if (picking) {
            const picked = pickFormat(box, cursor, pick)
            box = { ...box, ...picked.formats }
            textCursor = picked.cursor && { boxId: box.id, ...picked.cursor }
          }
          return {
            // While typing, remember just what was picked. Otherwise the next box copies this one.
            format: cursor ? { ...s.format, ...patch } : { style: box.style, color: box.color, look: box.look },
            boxes: s.boxes.map((b) => (b === selected ? box : b)),
            textCursor,
          }
        }),

      setSlideLook: (slideId, patch) =>
        set((s) => {
          const sections = s.sections.map((sec) =>
            sec.slides.some((sl) => sl.id === slideId)
              ? { ...sec, slides: sec.slides.map((sl) => (sl.id === slideId ? withLook(sl, patch, sectionLook(sec)) : sl)) }
              : sec,
          )
          showCurrentLook(sections, s.slide)
          return { sections }
        }),

      applySlideLookToSection: (slideId) =>
        set((s) => {
          const section = findSectionForSlide(s.sections, slideId)
          const slide = section?.slides.find((sl) => sl.id === slideId)
          if (!section || !slide) return {}
          const updated: Section = {
            id: section.id,
            title: section.title,
            ...sectionDefaults(slideLook(section, slide)),
            // Each slide's own choices go, so every slide now shows this one's look.
            slides: section.slides.map(({ backdrop: _b, cursorEffect: _c, particles: _p, ...sl }) => sl),
          }
          const sections = s.sections.map((sec) => (sec.id === section.id ? updated : sec))
          showCurrentLook(sections, s.slide)
          return { sections }
        }),

      moveSection: (sectionId, toIndex) =>
        set((s) => {
          const from = s.sections.findIndex((sec) => sec.id === sectionId)
          const to = Math.max(0, Math.min(s.sections.length - 1, Math.round(toIndex)))
          if (from === -1 || from === to) return {}
          const sections = [...s.sections]
          const [moved] = sections.splice(from, 1)
          sections.splice(to, 0, moved)
          return { sections }
        }),

      setSectionBackdrop: (sectionId, backdrop) =>
        set((s) => {
          const sections = s.sections.map((sec) =>
            sec.id === sectionId
              ? { ...sec, backdrop, slides: sec.slides.map((sl) => withLook(sl, {}, sectionLook({ ...sec, backdrop }))) }
              : sec,
          )
          showCurrentLook(sections, s.slide)
          return { sections }
        }),

      setSectionCursorEffect: (sectionId, cursorEffect) =>
        set((s) => {
          const sections = s.sections.map((sec) =>
            sec.id === sectionId
              ? { ...sec, cursorEffect, slides: sec.slides.map((sl) => withLook(sl, {}, sectionLook({ ...sec, cursorEffect }))) }
              : sec,
          )
          showCurrentLook(sections, s.slide)
          return { sections }
        }),

      setSectionParticles: (sectionId, particles) =>
        set((s) => {
          const sections = s.sections.map((sec) =>
            sec.id === sectionId
              ? { ...sec, particles, slides: sec.slides.map((sl) => withLook(sl, {}, sectionLook({ ...sec, particles }))) }
              : sec,
          )
          showCurrentLook(sections, s.slide)
          return { sections }
        }),

      setSlideSide: (slideId, side, textShift = 0) =>
        set((s) => {
          const boxes = textShift
            ? s.boxes.map((b) => (b.slide === slideId ? { ...b, x: Math.min(1, Math.max(0, b.x + textShift)) } : b))
            : s.boxes
          const sections = s.sections.map((sec) => ({
            ...sec,
            slides: sec.slides.map((sl) => {
              if (sl.id !== slideId) return sl
              const { side: _old, ...rest } = sl
              return side === 'left' ? { ...rest, side } : rest
            }),
          }))
          if (s.slide === slideId) useStage.getState().setSide(side)
          return { sections, boxes }
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
        // A new section starts with the look of the slide it was added from.
        const look = activeSec ? slideLook(activeSec, activeSec.slides.find((sl) => sl.id === s.slide)) : null
        const backdrop: BackdropTheme = look?.backdrop ?? 'blue'
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
          ...(look && sectionDefaults(look)),
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
        showSlideOnStage(slideSpec)
        showLookOnStage(sectionLook(newSection))
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
            showSlideOnStage(nextSlide)
            showLookOnStage(slideLook(nextSection, nextSlide))
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
        // A new slide keeps the layout of the one it was added from.
        const fromSlide = targetSec.slides.find((sl) => sl.id === s.slide)
        const newSlide: SlideSpec = {
          id: slideId,
          title: `${targetSec.title} (${slideNumber})`,
          focus: IDLE_FOCUS,
          ...(fromSlide?.side === 'left' && { side: 'left' as const }),
          ...(fromSlide?.backdrop && { backdrop: fromSlide.backdrop }),
          ...(fromSlide?.cursorEffect && { cursorEffect: fromSlide.cursorEffect }),
          ...(fromSlide?.particles && { particles: fromSlide.particles }),
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
        showSlideOnStage(newSlide)
        showLookOnStage(slideLook(targetSec, newSlide))
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
            showSlideOnStage(nextSlide)
            showLookOnStage(slideLook(section, nextSlide))
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
      version: 4,
      storage: createJSONStorage(() => localStorage),
      // The deck itself lives in the cloud, so a browser only keeps its own choice of format for new
      // boxes. Sections and boxes saved by earlier versions are dropped: the cloud copy replaces them.
      migrate: (saved) => {
        const format = (saved as Partial<Pick<DeckState, 'format'>> | undefined)?.format
        return format ? { format } : {}
      },
      partialize: (s) => ({ format: s.format }),
    },
  ),
)
