import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type TextStyle = 'title' | 'heading' | 'body'
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
}

/** What a new box says before anything is typed. It starts selected, so typing replaces it. */
export const STARTER_TEXT: Record<TextStyle, string> = {
  title: 'Title',
  heading: 'Heading',
  body: 'Body text',
}

interface DeckState {
  slide: string
  inputMode: boolean
  selectedId: string | null
  editingId: string | null
  boxes: TextBox[]
  /** Format for the next new box: the last one picked. */
  format: TextFormat
  setSlide: (slide: string) => void
  setInputMode: (on: boolean) => void
  addBox: () => void
  updateBox: (id: string, patch: Partial<Omit<TextBox, 'id' | 'slide'>>) => void
  removeBox: (id: string) => void
  select: (id: string | null) => void
  startEditing: (id: string) => void
  stopEditing: () => void
  /** Restyles the selected box, if any, and makes this the format for new boxes. */
  applyFormat: (patch: Partial<TextFormat>) => void
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

export const useDeck = create<DeckState>()(
  persist(
    (set) => ({
      slide: '1',
      inputMode: false,
      selectedId: null,
      editingId: null,
      boxes: [],
      format: { style: 'body', color: 'white', look: 'clear' },

      setSlide: (slide) =>
        set((s) => (s.slide === slide ? {} : { ...finishEditing(s), slide, selectedId: null })),

      setInputMode: (on) =>
        set((s) => (on ? { inputMode: true } : { ...finishEditing(s), inputMode: false, selectedId: null })),

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
    }),
    {
      name: 'anxiety-presentation:deck',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only the slides' content is kept. Where you are and what is selected start fresh.
      partialize: (s) => ({ boxes: s.boxes.filter((b) => b.text.trim()), format: s.format }),
    },
  ),
)
