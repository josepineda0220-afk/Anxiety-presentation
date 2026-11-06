import { create } from 'zustand'
import { IDLE_FOCUS, type Focus } from '../brain/regions'

interface StageState {
  focus: Focus
  /** Fraction of screen width to slide the brain right, clearing the text column. */
  shift: number
  setFocus: (focus: Focus) => void
  setShift: (shift: number) => void
}

export const useStage = create<StageState>((set) => ({
  focus: IDLE_FOCUS,
  shift: 0.17,
  setFocus: (focus) => set({ focus }),
  setShift: (shift) => set({ shift }),
}))

// Lets the browser console drive the stage while tuning camera angles.
if (import.meta.env.DEV) (window as unknown as { stage: typeof useStage }).stage = useStage
