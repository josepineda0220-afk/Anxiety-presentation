import { doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore'
import type { Section } from '../data/sections'
import { useDeck, type TextBox, type TextFormat } from '../deck/deckStore'
import { decryptDeck, encryptDeck, type EncryptedEnvelope } from './crypto'
import { PRESENTATION_ID } from './config'
import { getFirebase, isEditorSignedIn } from './firebase'
import { useSyncStatus } from './syncStatus'

export interface CloudDeckPayload {
  sections: Section[]
  boxes: TextBox[]
  format: TextFormat
}

/** The Firestore document: only the encrypted envelope and when it was saved. */
interface DeckDocument extends EncryptedEnvelope {
  updatedAt: Timestamp | null
}

function deckRef() {
  const firebase = getFirebase()
  return firebase ? doc(firebase.db, 'presentations', PRESENTATION_ID) : null
}

let applyingRemoteUpdate = false
let lastSavedCiphertext = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Encrypts the current deck with AES-256-GCM and saves it to Firestore. Only the signed-in editor may write. */
export async function pushDeckToCloud(): Promise<boolean> {
  const ref = deckRef()
  const deck = useDeck.getState()
  if (!ref || !deck.unlocked || !isEditorSignedIn()) return false

  useSyncStatus.getState().setStatus('saving')
  try {
    const payload: CloudDeckPayload = {
      sections: deck.sections,
      boxes: deck.boxes.filter((b) => b.text.trim().length > 0),
      format: deck.format,
    }
    const envelope = await encryptDeck(payload)
    lastSavedCiphertext = envelope.ciphertext
    await setDoc(ref, { ...envelope, updatedAt: serverTimestamp() })
    useSyncStatus.getState().markSynced(new Date().toISOString())
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Encryption or network error'
    useSyncStatus.getState().setStatus('error', message)
    return false
  }
}

async function applyEnvelopeFromCloud(envelope: EncryptedEnvelope, updatedAt?: string) {
  if (!envelope.ciphertext || envelope.ciphertext === lastSavedCiphertext) {
    useSyncStatus.getState().markSynced(updatedAt ?? new Date().toISOString())
    return
  }
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
 * Connects to Firestore on startup:
 * 1. Listens to the deck document. The first snapshot is the latest saved deck; later ones are teammates' edits.
 * 2. Debounces, encrypts and saves local edits made while Input Mode is unlocked.
 */
export function startCloudSync(): () => void {
  const ref = deckRef()
  if (!ref) {
    useSyncStatus.getState().setStatus('local')
    return () => {}
  }

  useSyncStatus.getState().setStatus('connecting')

  const unsubscribeDoc = onSnapshot(
    ref,
    (snapshot) => {
      // Our own save shows up here first as a local echo; wait for the server's copy instead.
      if (snapshot.metadata.hasPendingWrites) return
      const data = snapshot.data() as Partial<DeckDocument> | undefined
      if (data?.ciphertext && data.iv && data.salt) {
        void applyEnvelopeFromCloud(
          { ciphertext: data.ciphertext, iv: data.iv, salt: data.salt },
          data.updatedAt?.toDate().toISOString(),
        )
      } else {
        // Nothing saved yet: this browser's deck stands until the first edit saves it.
        useSyncStatus.getState().markSynced(new Date().toISOString())
      }
    },
    (err) => useSyncStatus.getState().setStatus('error', err.message),
  )

  let prevSections = useDeck.getState().sections
  let prevBoxes = useDeck.getState().boxes
  let prevFormat = useDeck.getState().format

  const unsubscribeStore = useDeck.subscribe((state) => {
    const changed = state.sections !== prevSections || state.boxes !== prevBoxes || state.format !== prevFormat
    prevSections = state.sections
    prevBoxes = state.boxes
    prevFormat = state.format

    if (!changed || applyingRemoteUpdate || !state.unlocked || !isEditorSignedIn()) return

    if (saveTimer) clearTimeout(saveTimer)
    useSyncStatus.getState().setStatus('saving')
    saveTimer = setTimeout(() => {
      void pushDeckToCloud()
    }, 600)
  })

  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    unsubscribeStore()
    unsubscribeDoc()
  }
}
