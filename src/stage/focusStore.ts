import { create } from 'zustand'
import { IDLE_FOCUS, type Focus } from '../brain/regions'
import type { BackdropTheme } from '../data/sections'

interface StageState {
  focus: Focus
  backdrop: BackdropTheme
  /** Fraction of screen width to slide the brain right, clearing the text column. */
  shift: number
  setFocus: (focus: Focus) => void
  setBackdrop: (backdrop: BackdropTheme) => void
  setShift: (shift: number) => void
}

export const useStage = create<StageState>((set) => ({
  focus: IDLE_FOCUS,
  backdrop: 'blue',
  shift: 0.17,
  setFocus: (focus) => set({ focus }),
  setBackdrop: (backdrop) => set({ backdrop }),
  setShift: (shift) => set({ shift }),
}))

// Lets the browser console drive the stage while tuning camera angles.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { stage: typeof useStage }).stage = useStage
}
