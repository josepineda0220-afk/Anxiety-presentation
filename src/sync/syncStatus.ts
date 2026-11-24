import { create } from 'zustand'
import type { Conflict, EngineState } from './engine'

/** What the save badge shows. */
export type SyncStatus = 'local' | 'connecting' | 'saved' | 'saving' | 'conflict' | 'offline' | 'error'

interface SyncState {
  /** False when this build has no Firebase settings, so the deck is view-only. */
  configured: boolean
  online: boolean
  engine: EngineState | null
  setConfigured: (configured: boolean) => void
  setOnline: (online: boolean) => void
  setEngine: (engine: EngineState) => void
}

export const useSyncStatus = create<SyncState>((set) => ({
  configured: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  engine: null,
  setConfigured: (configured) => set({ configured }),
  setOnline: (online) => set({ online }),
  setEngine: (engine) => set({ engine }),
}))

export function syncStatusOf(state: Pick<SyncState, 'configured' | 'online' | 'engine'>): SyncStatus {
  const { configured, online, engine } = state
  if (!configured) return 'local'
  if (engine && engine.conflicts.length > 0) return 'conflict'
  if (!online) return 'offline'
  if (!engine || engine.phase !== 'ready') return 'connecting'
  if (engine.problem) return 'error'
  if (engine.saving) return 'saving'
  return 'saved'
}

export const useSyncLabel = () => useSyncStatus(syncStatusOf)

export const useConflicts = (): Conflict[] => useSyncStatus((s) => s.engine?.conflicts ?? NO_CONFLICTS)
const NO_CONFLICTS: Conflict[] = []

/** True once the cloud deck has loaded, so edits made now are kept. */
export const isSyncReady = () => useSyncStatus.getState().engine?.phase === 'ready'
