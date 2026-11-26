/** The engine's transport, on Cloud Firestore. See schema.ts for the document layout. */
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocFromServer,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  setDoc,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import { SyncError, type IndexChange, type PartWrite, type SyncTransport } from './engine'
import {
  SCHEMA_VERSION,
  arrangeLike,
  decodeSnapshot,
  encodeSnapshot,
  partDocument,
  partFromDoc,
  type DeckIndex,
  type DeckSnapshot,
  type PartKind,
  type RemotePart,
} from './schema'

/** Most writes in one batch is 500; this leaves room for the index. */
const BATCH_LIMIT = 450

const collectionFor = (kind: PartKind) => (kind === 'section' ? 'sections' : 'boxes')

/** Firestore error codes that mean the rules said no. Anything else is worth trying again. */
const REFUSED = new Set(['permission-denied', 'failed-precondition', 'unauthenticated', 'invalid-argument', 'already-exists'])

function toSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error
  const code = (error as { code?: string }).code ?? ''
  const message = error instanceof Error ? error.message : String(error)
  return new SyncError(REFUSED.has(code) ? 'refused' : 'retry', message)
}

async function guarded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    throw toSyncError(error)
  }
}

const millis = (value: unknown) => ((value as Timestamp | null)?.toMillis?.() ?? 0)

function readIndex(data: DocumentData): DeckIndex {
  return {
    revision: Number(data.revision) || 0,
    sectionOrder: Array.isArray(data.sectionOrder) ? data.sectionOrder : [],
    boxIds: Array.isArray(data.boxIds) ? data.boxIds : [],
    snapshotSeq: Number(data.snapshotSeq) || 0,
    lastSnapshotAt: millis(data.lastSnapshotAt),
  }
}

function readPart(kind: PartKind, snapshot: DocumentSnapshot): RemotePart {
  if (!snapshot.exists()) return { revision: 0, data: null }
  const data = snapshot.data()
  return { revision: Number(data.revision) || 0, data: partFromDoc(kind, data) }
}

/**
 * Only the server's word counts. A snapshot of this device's own unsent write is skipped, and so is
 * "no such document" from an empty local cache, which only means the server has not answered yet.
 */
const isServerTruth = (snapshot: DocumentSnapshot) =>
  !snapshot.metadata.hasPendingWrites && (snapshot.exists() || !snapshot.metadata.fromCache)

export interface SavedVersion {
  seq: number
  savedAt: Date | null
  sectionCount: number
  boxCount: number
  snapshot: DeckSnapshot | null
}

export function createFirestoreTransport(db: Firestore, deckId: string, uid: () => string | null): SyncTransport & {
  listVersions(count?: number): Promise<SavedVersion[]>
} {
  const indexRef = doc(db, 'presentations', deckId)
  const partRef = (kind: PartKind, id: string) => doc(db, 'presentations', deckId, collectionFor(kind), id)

  const editor = () => {
    const id = uid()
    if (!id) throw new SyncError('refused', 'Not signed in')
    return id
  }

  const stamp = (by: string) => ({ revision: increment(1), updatedAt: serverTimestamp(), updatedBy: by })

  const partData = (write: PartWrite, by: string) => ({
    ...partDocument(write.kind, write.data, write.previous, write.revision, by),
    updatedAt: serverTimestamp(),
  })

  return {
    watchIndex(onIndex, onError) {
      return onSnapshot(
        indexRef,
        (snapshot) => {
          if (!isServerTruth(snapshot)) return
          if (!snapshot.exists()) return onIndex(null)
          const data = snapshot.data()
          // The old encrypted document, before tools/migrate-plaintext.mjs has run: show the deck
          // built into the app, and save nothing until the migration is done.
          if (data.schemaVersion !== SCHEMA_VERSION) {
            return onError(new Error('The cloud deck is in the old format. It needs tools/migrate-plaintext.mjs before anyone can edit.'))
          }
          onIndex(readIndex(data))
        },
        onError,
      )
    },

    watchPart(kind, id, onPart) {
      return onSnapshot(
        partRef(kind, id),
        (snapshot) => {
          if (isServerTruth(snapshot)) onPart(readPart(kind, snapshot))
        },
        (error) => console.warn(`Stopped following ${kind} ${id}:`, error.message),
      )
    },

    async fetchPart(kind, id) {
      return readPart(kind, await guarded(getDocFromServer(partRef(kind, id))))
    },

    async writePart(write) {
      const by = editor()
      await guarded(setDoc(partRef(write.kind, write.id), partData(write, by)))
    },

    async updateIndex(change: IndexChange) {
      const by = editor()
      // One field cannot take arrayUnion and arrayRemove in the same update, so removals go first.
      const removals = {
        ...(change.removeSections.length > 0 && { sectionOrder: arrayRemove(...change.removeSections) }),
        ...(change.removeBoxes.length > 0 && { boxIds: arrayRemove(...change.removeBoxes) }),
      }
      const additions = {
        ...(change.addSections.length > 0 && { sectionOrder: arrayUnion(...change.addSections) }),
        ...(change.addBoxes.length > 0 && { boxIds: arrayUnion(...change.addBoxes) }),
      }
      if (Object.keys(removals).length) await guarded(updateDoc(indexRef, { ...removals, ...stamp(by) }))
      if (Object.keys(additions).length) await guarded(updateDoc(indexRef, { ...additions, ...stamp(by) }))
    },

    async reorderSections(order) {
      const by = editor()
      // Read and write together, so a section someone adds meanwhile is never dropped.
      return guarded(
        runTransaction(db, async (tx) => {
          const snapshot = await tx.get(indexRef)
          if (!snapshot.exists()) throw new SyncError('refused', 'There is no deck to reorder.')
          const index = readIndex(snapshot.data())
          const sectionOrder = arrangeLike(index.sectionOrder, order)
          if (sectionOrder.every((id, i) => id === index.sectionOrder[i])) return index.revision
          tx.update(indexRef, { sectionOrder, ...stamp(by) })
          return index.revision + 1
        }),
      )
    },

    async saveSnapshot(seq, snapshot, deckRevision) {
      const by = editor()
      const batch = writeBatch(db)
      batch.set(doc(db, 'presentations', deckId, 'versions', String(seq)), {
        schemaVersion: SCHEMA_VERSION,
        revision: 1,
        updatedAt: serverTimestamp(),
        updatedBy: by,
        seq,
        deckRevision,
        sectionCount: snapshot.sectionOrder.length,
        boxCount: Object.keys(snapshot.boxes).length,
        deckJson: encodeSnapshot(snapshot),
      })
      batch.update(indexRef, { snapshotSeq: seq, lastSnapshotAt: serverTimestamp(), ...stamp(by) })
      await guarded(batch.commit())
    },

    async writeDeck(writes, lists, create) {
      const by = editor()
      // Parts go first and the index last, so nobody is pointed at a part before it exists. A deck
      // the size of this one fits in a single, all-or-nothing batch.
      const chunks: PartWrite[][] = []
      for (let i = 0; i < writes.length; i += BATCH_LIMIT) chunks.push(writes.slice(i, i + BATCH_LIMIT))
      if (chunks.length === 0) chunks.push([])
      for (const [i, chunk] of chunks.entries()) {
        const batch = writeBatch(db)
        for (const write of chunk) batch.set(partRef(write.kind, write.id), partData(write, by))
        if (i === chunks.length - 1) {
          if (create) {
            batch.set(indexRef, {
              schemaVersion: SCHEMA_VERSION,
              revision: 1,
              updatedAt: serverTimestamp(),
              updatedBy: by,
              sectionOrder: lists.sectionOrder,
              boxIds: lists.boxIds,
              snapshotSeq: 0,
              lastSnapshotAt: serverTimestamp(),
            })
          } else {
            batch.update(indexRef, { sectionOrder: lists.sectionOrder, boxIds: lists.boxIds, ...stamp(by) })
          }
        }
        await guarded(batch.commit())
      }
    },

    async listVersions(count = 20) {
      const snapshots = await guarded(getDocs(query(collection(db, 'presentations', deckId, 'versions'), orderBy('seq', 'desc'), limit(count))))
      return snapshots.docs.map((snapshot) => {
        const data = snapshot.data()
        return {
          seq: Number(data.seq) || 0,
          savedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate() : null,
          sectionCount: Number(data.sectionCount) || 0,
          boxCount: Number(data.boxCount) || 0,
          snapshot: typeof data.deckJson === 'string' ? decodeSnapshot(data.deckJson) : null,
        }
      })
    },
  }
}
