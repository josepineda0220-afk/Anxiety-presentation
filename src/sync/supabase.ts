import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { Section } from '../data/sections'
import { useDeck, type TextBox, type TextFormat } from '../deck/deckStore'
import { decryptDeck, encryptDeck, type EncryptedEnvelope } from './crypto'

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

export interface CloudDeckPayload {
  sections: Section[]
  boxes: TextBox[]
  format: TextFormat
}

const PRESENTATION_ID = (import.meta.env.VITE_PRESENTATION_ID as string | undefined)?.trim() || 'anxiety-deck'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  if (!url || !anonKey) return null
  client = createClient(url, anonKey, {
    auth: { persistSession: false },
  })
  return client
}

export function isCloudConfigured(): boolean {
  return getSupabaseClient() !== null
}

let applyingRemoteUpdate = false
let lastSavedCiphertext = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Encrypts the current deck state with AES-256-GCM and saves it to Supabase via the
 * password-verified `save_presentation` RPC.
 */
export async function pushDeckToCloud(): Promise<boolean> {
  const supabase = getSupabaseClient()
  const deck = useDeck.getState()
  if (!supabase || !deck.unlocked || !deck.editToken) return false

  useSyncStatus.getState().setStatus('saving')
  try {
    const payload: CloudDeckPayload = {
      sections: deck.sections,
      boxes: deck.boxes.filter((b) => b.text.trim().length > 0),
      format: deck.format,
    }
    const envelope = await encryptDeck(payload)
    lastSavedCiphertext = envelope.ciphertext

    const { data, error } = await supabase.rpc('save_presentation', {
      p_id: PRESENTATION_ID,
      p_ciphertext: envelope.ciphertext,
      p_iv: envelope.iv,
      p_salt: envelope.salt,
      p_edit_token: deck.editToken,
    })

    if (error) {
      useSyncStatus.getState().setStatus('error', error.message)
      return false
    }

    useSyncStatus.getState().markSynced(typeof data === 'string' ? data : new Date().toISOString())
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Encryption or network error'
    useSyncStatus.getState().setStatus('error', message)
    return false
  }
}

async function applyEnvelopeFromCloud(envelope: EncryptedEnvelope, updatedAt?: string) {
  if (!envelope.ciphertext || envelope.ciphertext === lastSavedCiphertext) return
  try {
    const decrypted = await decryptDeck<CloudDeckPayload>(envelope)
    if (!decrypted || !Array.isArray(decrypted.sections) || !Array.isArray(decrypted.boxes)) return
    applyingRemoteUpdate = true
    lastSavedCiphertext = envelope.ciphertext
    useDeck.getState().replaceDeckFromCloud(decrypted)
    useSyncStatus.getState().markSynced(updatedAt ?? new Date().toISOString())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to decrypt cloud deck'
    useSyncStatus.getState().setStatus('error', message)
  } finally {
    applyingRemoteUpdate = false
  }
}

/**
 * Connects to Supabase on startup:
 * 1. Fetches and decrypts the latest presentation state.
 * 2. Subscribes to Realtime updates from teammates.
 * 3. Debounces and encrypts local edits made while Input Mode is unlocked.
 */
export function startCloudSync(): () => void {
  const supabase = getSupabaseClient()
  if (!supabase) {
    useSyncStatus.getState().setStatus('local')
    return () => {}
  }

  useSyncStatus.getState().setStatus('connecting')

  // 1. Initial fetch of encrypted presentation row
  void (async () => {
    const { data, error } = await supabase
      .from('presentations')
      .select('ciphertext, iv, salt, updated_at')
      .eq('id', PRESENTATION_ID)
      .maybeSingle()

    if (error) {
      useSyncStatus.getState().setStatus('error', error.message)
      return
    }

    if (data) {
      await applyEnvelopeFromCloud(
        { ciphertext: data.ciphertext, iv: data.iv, salt: data.salt },
        data.updated_at,
      )
    } else {
      useSyncStatus.getState().markSynced(new Date().toISOString())
    }
  })()

  // 2. Subscribe to live updates from teammates
  const channel = supabase
    .channel(`presentation:${PRESENTATION_ID}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'presentations',
        filter: `id=eq.${PRESENTATION_ID}`,
      },
      (payload) => {
        const row = payload.new as Partial<EncryptedEnvelope & { updated_at: string }> | undefined
        if (row?.ciphertext && row.iv && row.salt) {
          void applyEnvelopeFromCloud(
            { ciphertext: row.ciphertext, iv: row.iv, salt: row.salt },
            row.updated_at,
          )
        }
      },
    )
    .subscribe()

  // 3. Watch local store edits when unlocked and push encrypted snapshots
  let prevSections = useDeck.getState().sections
  let prevBoxes = useDeck.getState().boxes
  let prevFormat = useDeck.getState().format

  const unsubscribeStore = useDeck.subscribe((state) => {
    const changed =
      state.sections !== prevSections || state.boxes !== prevBoxes || state.format !== prevFormat
    prevSections = state.sections
    prevBoxes = state.boxes
    prevFormat = state.format

    if (!changed || applyingRemoteUpdate || !state.unlocked || !state.editToken) return

    if (saveTimer) clearTimeout(saveTimer)
    useSyncStatus.getState().setStatus('saving')
    saveTimer = setTimeout(() => {
      void pushDeckToCloud()
    }, 600)
  })

  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    unsubscribeStore()
    void supabase.removeChannel(channel)
  }
}
