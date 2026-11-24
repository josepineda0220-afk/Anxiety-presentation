/**
 * Connects the deck store to Firestore through the sync engine. This module and the Firebase SDK
 * load in their own chunk after the first paint (see main.tsx).
 */
import type { Section } from '../data/sections'
import { useDeck, type TextBox } from '../deck/deckStore'
import { SyncEngine, type ConflictChoice, type LocalDeck } from './engine'
import { PRESENTATION_ID } from './config'
import { currentUid, getFirebase, signInEditor, signOutEditor, watchEditor, type SignInResult } from './firebase'
import { createFirestoreTransport, type SavedVersion } from './firestoreTransport'
import { boxToData, partKey, sectionToData, snapshotToDeck, type DeckSnapshot } from './schema'
import { useSyncStatus } from './syncStatus'

let engine: SyncEngine | null = null
let transport: ReturnType<typeof createFirestoreTransport> | null = null
/** Set while the engine writes into the store, so those changes are not saved back. */
let applying = false

function quietly(change: () => void) {
  applying = true
  try {
    change()
  } finally {
    applying = false
  }
}

/** The deck store, as the engine sees it. */
const storeDeck: LocalDeck = {
  read(kind, id) {
    const state = useDeck.getState()
    if (kind === 'section') {
      const section = state.sections.find((s) => s.id === id)
      return section ? sectionToData(section) : null
    }
    const box = state.boxes.find((b) => b.id === id)
    return box ? boxToData(box) : null
  },
  apply(kind, id, data) {
    quietly(() => useDeck.getState().applyRemotePart(kind, id, data))
  },
  replaceAll(snapshot) {
    quietly(() => useDeck.getState().replaceDeck(snapshotToDeck(snapshot)))
  },
  orderSections(order) {
    quietly(() => useDeck.getState().orderSections(order))
  },
  ids() {
    const state = useDeck.getState()
    return { sectionOrder: state.sections.map((s) => s.id), boxIds: state.boxes.map((b) => b.id) }
  },
  editingKey() {
    const id = useDeck.getState().editingId
    return id ? partKey('box', id) : null
  },
}

/** The parts that differ between two versions of the store, by identity: the store never mutates. */
function changedParts(before: { sections: Section[]; boxes: TextBox[] }, after: { sections: Section[]; boxes: TextBox[] }) {
  const keys: string[] = []
  const diff = <T extends { id: string }>(kind: 'section' | 'box', a: T[], b: T[]) => {
    if (a === b) return
    const old = new Map(a.map((item) => [item.id, item]))
    for (const item of b) {
      if (old.get(item.id) !== item) keys.push(partKey(kind, item.id))
      old.delete(item.id)
    }
    for (const id of old.keys()) keys.push(partKey(kind, id))
  }
  diff('section', before.sections, after.sections)
  diff('box', before.boxes, after.boxes)
  return keys
}

/** Starts following the cloud deck, and saving edits while signed in. Returns a function that stops. */
export function startCloudSync(): () => void {
  const firebase = getFirebase()
  const status = useSyncStatus.getState()
  if (!firebase) {
    status.setConfigured(false)
    return () => {}
  }
  status.setConfigured(true)

  transport = createFirestoreTransport(firebase.db, PRESENTATION_ID, currentUid)
  const syncEngine = new SyncEngine(transport, storeDeck, { onState: (state) => useSyncStatus.getState().setEngine(state) })
  engine = syncEngine
  syncEngine.start()

  const stopAuth = watchEditor((signedIn) => {
    syncEngine.setWritable(signedIn)
    useDeck.getState().setUnlocked(signedIn)
  })

  let previous = useDeck.getState()
  const stopStore = useDeck.subscribe((state) => {
    const before = previous
    previous = state
    if (applying) return
    const keys = changedParts(before, state)
    if (keys.length > 0) syncEngine.localChanged(keys)
    if (before.editingId && before.editingId !== state.editingId) syncEngine.editingStopped(partKey('box', before.editingId))
  })

  const onOnline = () => useSyncStatus.getState().setOnline(navigator.onLine)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOnline)
  onOnline()

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOnline)
    stopStore()
    stopAuth()
    syncEngine.stop()
    engine = null
    transport = null
  }
}

export async function signIn(password: string): Promise<SignInResult> {
  return signInEditor(password)
}

/** Saves what is waiting (for a few seconds at most), then signs out. */
export async function signOut(): Promise<void> {
  await engine?.flushNow()
  await signOutEditor()
}

export function resolveConflict(key: string, choice: ConflictChoice) {
  engine?.resolveConflict(key, choice)
}

export async function listVersions(): Promise<SavedVersion[]> {
  if (!transport) return []
  return transport.listVersions()
}

export async function restoreVersion(snapshot: DeckSnapshot): Promise<void> {
  if (!engine) throw new Error('The deck is not connected.')
  await engine.restore(snapshot)
}
