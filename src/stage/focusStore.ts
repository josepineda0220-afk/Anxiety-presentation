import { create } from 'zustand'
import { IDLE_FOCUS, type Focus } from '../brain/regions'
import { DEFAULT_CURSOR_EFFECT, type BackdropTheme, type CursorEffect } from '../data/sections'

interface StageState {
  focus: Focus
  backdrop: BackdropTheme
  cursorEffect: CursorEffect
  /** True while the viewer has taken hold of the brain to turn it and pull it apart. */
  explore: boolean
  /** Fraction of screen width to slide the brain right, clearing the text column. */
  shift: number
  setFocus: (focus: Focus) => void
  setBackdrop: (backdrop: BackdropTheme) => void
  setCursorEffect: (cursorEffect: CursorEffect) => void
  setExplore: (explore: boolean) => void
  setShift: (shift: number) => void
}

export const useStage = create<StageState>((set) => ({
  focus: IDLE_FOCUS,
  backdrop: 'blue',
  cursorEffect: DEFAULT_CURSOR_EFFECT,
  explore: false,
  shift: 0.17,
  setFocus: (focus) => set({ focus }),
  setBackdrop: (backdrop) => set({ backdrop }),
  setCursorEffect: (cursorEffect) => set({ cursorEffect }),
  setExplore: (explore) => set({ explore }),
  setShift: (shift) => set({ shift }),
}))

// Lets the browser console drive the stage while tuning camera angles.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { stage: typeof useStage }).stage = useStage
}
