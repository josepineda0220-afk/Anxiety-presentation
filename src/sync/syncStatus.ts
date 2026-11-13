import { create } from 'zustand'

export type SyncStatus = 'local' | 'connecting' | 'synced' | 'saving' | 'error'

interface SyncState {
  status: SyncStatus
  lastSyncedAt: string | null
  errorMessage: string | null
  setStatus: (status: SyncStatus, errorMessage?: string | null) => void
  markSynced: (timestamp: string) => void
}

export const useSyncStatus = create<SyncState>((set) => ({
  status: 'local',
  lastSyncedAt: null,
  errorMessage: null,
  setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
  markSynced: (timestamp) => set({ status: 'synced', lastSyncedAt: timestamp, errorMessage: null }),
}))
