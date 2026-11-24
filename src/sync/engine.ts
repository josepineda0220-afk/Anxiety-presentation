/**
 * Keeps the deck on this device and the deck in Firestore in step, one section or text box at a time.
 *
 * - Each part saves on its own, debounced, with at most one save in flight per part. A save names
 *   the revision it replaces plus one, and the rules refuse it if someone saved that part first.
 * - Someone else's change to a part this device has not touched is applied straight away. If both
 *   changed it, the changes are merged field by field, and only a field both changed differently
 *   becomes a conflict for the person editing to settle.
 * - A change to the box someone is typing in waits until they stop typing.
 * - About every 5 minutes of editing, a snapshot of the whole deck is added to its history.
 *
 * This module knows nothing about Firebase or React: the transport and the deck are passed in, so
 * the tests drive it against a fake server.
 */
import { mergeKeepingBoth, threeWayMerge } from './merge'
import {
  SNAPSHOT_INTERVAL_MS,
  parsePartKey,
  partKey,
  partProblem,
  sameData,
  type DeckIndex,
  type DeckSnapshot,
  type PartData,
  type PartKind,
  type RemotePart,
  type SectionData,
  type BoxData,
} from './schema'

/** Why a write did not go through: refused by the rules, or worth trying again later. */
export class SyncError extends Error {
  constructor(
    readonly reason: 'refused' | 'retry',
    message: string,
  ) {
    super(message)
  }
}

export interface PartWrite {
  kind: PartKind
  id: string
  /** Null removes the part (it is saved with `deleted: true`). */
  data: PartData | null
  /** The content before this write, kept in a removed part's document. */
  previous: PartData | null
  revision: number
}

export interface IndexChange {
  addSections: string[]
  removeSections: string[]
  addBoxes: string[]
  removeBoxes: string[]
}

export interface SyncTransport {
  watchIndex(onIndex: (index: DeckIndex | null) => void, onError: (error: Error) => void): () => void
  watchPart(kind: PartKind, id: string, onPart: (part: RemotePart) => void): () => void
  /** The part as the server has it now. */
  fetchPart(kind: PartKind, id: string): Promise<RemotePart>
  writePart(write: PartWrite): Promise<void>
  updateIndex(change: IndexChange): Promise<void>
  saveSnapshot(seq: number, snapshot: DeckSnapshot, deckRevision: number): Promise<void>
  /** Writes every part and the index lists together, or none of them. */
  writeDeck(writes: PartWrite[], lists: { sectionOrder: string[]; boxIds: string[] }, create: boolean): Promise<void>
}

/** The deck on this device. */
export interface LocalDeck {
  read(kind: PartKind, id: string): PartData | null
  apply(kind: PartKind, id: string, data: PartData | null): void
  replaceAll(snapshot: DeckSnapshot): void
  /** Puts sections in this order. Sections it leaves out keep their place after these. */
  orderSections(order: string[]): void
  ids(): { sectionOrder: string[]; boxIds: string[] }
  /** The part being typed in, as a part key, if any. */
  editingKey(): string | null
}

export interface Conflict {
  key: string
  kind: PartKind
  id: string
  /** Fields both sides changed in different ways; 'deleted' when one side removed the part. */
  fields: string[]
  mine: PartData | null
  theirs: PartData | null
}

export type ConflictChoice = 'theirs' | 'mine' | 'merge'

export interface EngineState {
  /** 'missing' means there is no deck in the cloud yet. */
  phase: 'connecting' | 'missing' | 'ready'
  saving: boolean
  conflicts: Conflict[]
  /** Parts someone else changed while they were being typed in here. */
  held: number
  problem: string | null
  lastSavedAt: number | null
}

interface Timers {
  now: () => number
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export interface EngineOptions {
  debounceMs?: number
  /** Keeps saving during a long stretch of typing. */
  maxWaitMs?: number
  timers?: Timers
  onState?: (state: EngineState) => void
}

interface PartState {
  kind: PartKind
  id: string
  /** The server version the local copy is based on. Revision 0 means never saved. */
  base: RemotePart
  /** The newest server version seen. */
  remote: RemotePart
  loaded: boolean
  inFlight: { revision: number; data: PartData | null } | null
  conflict: { base: PartData | null; fields: string[] } | null
  /** Someone else's change is waiting for typing in this part to stop. */
  held: boolean
  problem: string | null
  retryHandle: unknown
  retries: number
  unwatch: (() => void) | null
}

const NEVER_SAVED: RemotePart = { revision: 0, data: null }

const defaultTimers: Timers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class SyncEngine {
  private readonly parts = new Map<string, PartState>()
  private readonly touched = new Set<string>()
  private readonly debounceMs: number
  private readonly maxWaitMs: number
  private readonly timers: Timers
  private readonly onState?: (state: EngineState) => void

  private index: DeckIndex | null | undefined = undefined
  private ready = false
  private writable = false
  private creating = false
  private restoring = false
  private flushHandle: unknown = null
  private firstTouchAt: number | null = null
  private pendingIndex: IndexChange = { addSections: [], removeSections: [], addBoxes: [], removeBoxes: [] }
  private indexInFlight = false
  private indexRetryHandle: unknown = null
  private snapshotInFlight = false
  private lastSnapshotTry = -Infinity
  private lastSavedAt: number | null = null
  private problem: string | null = null
  private stopIndex: (() => void) | null = null
  private lastState = ''

  constructor(
    private readonly transport: SyncTransport,
    private readonly deck: LocalDeck,
    options: EngineOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 800
    this.maxWaitMs = options.maxWaitMs ?? 4000
    this.timers = options.timers ?? defaultTimers
    this.onState = options.onState
  }

  start() {
    this.stopIndex = this.transport.watchIndex(
      (index) => this.handleIndex(index),
      (error) => this.setProblem(`Can't reach the deck: ${error.message}`),
    )
    this.emit()
  }

  stop() {
    this.stopIndex?.()
    for (const part of this.parts.values()) {
      part.unwatch?.()
      if (part.retryHandle) this.timers.clear(part.retryHandle)
    }
    if (this.flushHandle) this.timers.clear(this.flushHandle)
    if (this.indexRetryHandle) this.timers.clear(this.indexRetryHandle)
    this.parts.clear()
  }

  /** Whether this device is signed in as the editor and may save. */
  setWritable(writable: boolean) {
    this.writable = writable
    if (writable) {
      this.createDeckIfMissing()
      this.scheduleFlush(0)
    }
    this.emit()
  }

  isReady() {
    return this.ready
  }

  state(): EngineState {
    const conflicts: Conflict[] = []
    let saving = this.touched.size > 0 || this.indexInFlight || this.hasPendingIndex() || this.restoring || this.creating
    let held = 0
    let problem = this.problem
    for (const part of this.parts.values()) {
      if (part.inFlight || part.retryHandle) saving = true
      if (part.held) held++
      if (part.problem) problem ??= part.problem
      if (part.conflict) {
        conflicts.push({
          key: partKey(part.kind, part.id),
          kind: part.kind,
          id: part.id,
          fields: part.conflict.fields,
          mine: this.deck.read(part.kind, part.id),
          theirs: part.remote.data,
        })
      }
    }
    const phase = this.ready ? 'ready' : this.index === null ? 'missing' : 'connecting'
    return { phase, saving, conflicts, held, problem, lastSavedAt: this.lastSavedAt }
  }

  // ---- From the server ------------------------------------------------------------------------

  private handleIndex(index: DeckIndex | null) {
    this.index = index
    // A readable index means whatever kept the deck from loading has passed.
    this.problem = null
    if (index === null) {
      this.createDeckIfMissing()
      this.emit()
      return
    }
    for (const id of index.sectionOrder) this.watch('section', id)
    for (const id of index.boxIds) this.watch('box', id)
    // Drop what the index no longer lists, unless this device still has something to say about it.
    const listed = new Set([...index.sectionOrder.map((id) => partKey('section', id)), ...index.boxIds.map((id) => partKey('box', id))])
    for (const [key, part] of this.parts) {
      if (!listed.has(key) && part.loaded && this.isSettled(part) && part.base.data === null) {
        part.unwatch?.()
        this.parts.delete(key)
      }
    }
    if (this.ready) this.deck.orderSections(this.sectionOrder())
    else this.hydrateIfLoaded()
    this.emit()
  }

  private watch(kind: PartKind, id: string) {
    const key = partKey(kind, id)
    const existing = this.parts.get(key)
    if (existing?.unwatch) return existing
    const part = existing ?? this.newPart(kind, id)
    this.parts.set(key, part)
    part.unwatch = this.transport.watchPart(kind, id, (remote) => this.handlePart(part, remote))
    return part
  }

  private newPart(kind: PartKind, id: string): PartState {
    return {
      kind,
      id,
      base: NEVER_SAVED,
      remote: NEVER_SAVED,
      loaded: false,
      inFlight: null,
      conflict: null,
      held: false,
      problem: null,
      retryHandle: null,
      retries: 0,
      unwatch: null,
    }
  }

  private handlePart(part: PartState, remote: RemotePart) {
    if (remote.revision < part.remote.revision) return
    part.remote = remote
    if (!part.loaded) {
      part.loaded = true
      if (!this.ready) {
        part.base = remote
        this.hydrateIfLoaded()
        this.emit()
        return
      }
    }
    // This device's own save, coming back from the server.
    if (part.inFlight && remote.revision === part.inFlight.revision && sameData(remote.data, part.inFlight.data)) {
      part.base = remote
      this.emit()
      return
    }
    if (remote.revision <= part.base.revision || part.inFlight) {
      this.emit()
      return
    }
    this.reconcile(part)
    this.emit()
  }

  private hydrateIfLoaded() {
    const index = this.index
    if (!index || this.ready) return
    const keys = [...index.sectionOrder.map((id) => partKey('section', id)), ...index.boxIds.map((id) => partKey('box', id))]
    if (!keys.every((key) => this.parts.get(key)?.loaded)) return
    const snapshot: DeckSnapshot = { sectionOrder: [], sections: {}, boxes: {} }
    for (const id of index.sectionOrder) {
      const data = this.parts.get(partKey('section', id))?.base.data
      if (data) {
        snapshot.sectionOrder.push(id)
        snapshot.sections[id] = data as SectionData
      }
    }
    for (const id of index.boxIds) {
      const data = this.parts.get(partKey('box', id))?.base.data
      if (data) snapshot.boxes[id] = data as BoxData
    }
    this.deck.replaceAll(snapshot)
    this.ready = true
    this.touched.clear()
  }

  /**
   * Brings a part up to the newest server version, which is ahead of what this device's copy is
   * based on. Nothing may be in flight for it.
   */
  private reconcile(part: PartState) {
    if (part.conflict) return
    const key = partKey(part.kind, part.id)
    const local = this.deck.read(part.kind, part.id)
    // Never change the box someone is typing in. Look again when they stop.
    if (this.deck.editingKey() === key) {
      part.held = true
      return
    }
    part.held = false
    const theirs = part.remote
    if (sameData(local, part.base.data)) {
      this.deck.apply(part.kind, part.id, theirs.data)
      part.base = theirs
      this.afterRemoteApply(part)
      return
    }
    const { merged, conflicts } = threeWayMerge(part.base.data, local, theirs.data)
    if (conflicts.length > 0) {
      part.conflict = { base: part.base.data, fields: conflicts }
      return
    }
    part.base = theirs
    if (!sameData(merged, local)) this.deck.apply(part.kind, part.id, merged)
    this.afterRemoteApply(part)
    if (!sameData(merged, theirs.data)) this.touch(key)
  }

  private afterRemoteApply(part: PartState) {
    if (part.kind === 'section') this.deck.orderSections(this.sectionOrder())
  }

  // ---- From this device -----------------------------------------------------------------------

  /** Parts the person changed here. They save after a short pause in typing. */
  localChanged(keys: Iterable<string>) {
    if (!this.ready || !this.writable) return
    let any = false
    for (const key of keys) {
      this.touched.add(key)
      any = true
    }
    if (!any) return
    this.firstTouchAt ??= this.timers.now()
    const waited = this.timers.now() - this.firstTouchAt
    this.scheduleFlush(waited >= this.maxWaitMs ? 0 : this.debounceMs)
    this.emit()
  }

  /** Typing in a part stopped, so anything held back for it can be looked at now. */
  editingStopped(key: string) {
    const part = this.parts.get(key)
    if (part?.held) {
      this.reconcile(part)
      this.emit()
    }
    if (!this.ready || !this.writable) return
    this.touched.add(key)
    this.scheduleFlush(0)
  }

  /** Saves everything now and waits for it, for example before signing out. */
  flushNow(): Promise<void> {
    return this.waitForSaves()
  }

  private scheduleFlush(ms: number) {
    if (this.flushHandle) this.timers.clear(this.flushHandle)
    this.flushHandle = this.timers.set(() => {
      this.flushHandle = null
      this.flush()
    }, ms)
  }

  private flush() {
    if (!this.writable || !this.ready || this.restoring) return
    const keys = [...this.touched]
    this.touched.clear()
    this.firstTouchAt = null
    for (const key of keys) {
      const { kind, id } = parsePartKey(key)
      let part = this.parts.get(key)
      if (!part) {
        part = this.newPart(kind, id)
        // A part made here starts out known: it has never been saved.
        part.loaded = true
        this.parts.set(key, part)
        this.watch(kind, id)
      }
      this.save(part)
    }
    this.flushIndex()
    this.emit()
  }

  private save(part: PartState) {
    if (part.inFlight || part.conflict || part.retryHandle || !this.writable) return
    if (part.remote.revision > part.base.revision) {
      this.reconcile(part)
      if (part.conflict || part.held) return
    }
    const data = this.deck.read(part.kind, part.id)
    if (sameData(data, part.base.data)) {
      part.problem = null
      return
    }
    const problem = partProblem(part.kind, data)
    part.problem = problem
    if (problem) return

    const write: PartWrite = { kind: part.kind, id: part.id, data, previous: part.base.data, revision: part.base.revision + 1 }
    part.inFlight = { revision: write.revision, data }
    this.transport.writePart(write).then(
      () => this.saved(part, write),
      (error: unknown) => this.saveFailed(part, write, error),
    )
  }

  private saved(part: PartState, write: PartWrite) {
    part.inFlight = null
    part.retries = 0
    part.problem = null
    if (write.revision > part.base.revision) part.base = { revision: write.revision, data: write.data }
    if (part.remote.revision < part.base.revision) part.remote = part.base
    this.lastSavedAt = this.timers.now()
    this.problem = null
    this.noteIndexMembership(part)
    if (part.remote.revision > part.base.revision) this.reconcile(part)
    else if (!sameData(this.deck.read(part.kind, part.id), part.base.data)) this.touch(partKey(part.kind, part.id))
    this.flushIndex()
    this.maybeSnapshot()
    this.emit()
  }

  private async saveFailed(part: PartState, write: PartWrite, error: unknown) {
    part.inFlight = null
    const reason = error instanceof SyncError ? error.reason : 'retry'
    if (reason === 'retry') {
      this.retryLater(part)
      this.emit()
      return
    }
    // Refused. Usually someone saved this part first; find out what the server has now.
    try {
      const latest = await this.transport.fetchPart(part.kind, part.id)
      if (latest.revision > part.remote.revision) part.remote = latest
      if (sameData(latest.data, write.data) && latest.revision >= write.revision) {
        this.saved(part, { ...write, revision: latest.revision })
        return
      }
      if (part.remote.revision > part.base.revision) {
        part.problem = null
        this.reconcile(part)
        if (!part.conflict && !part.held) this.save(part)
      } else {
        part.problem = 'Saving was refused. Lock and unlock Input mode to sign in again.'
      }
    } catch {
      this.retryLater(part)
    }
    this.emit()
  }

  private retryLater(part: PartState) {
    part.retries++
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(part.retries, 5))
    part.retryHandle = this.timers.set(() => {
      part.retryHandle = null
      this.save(part)
      this.emit()
    }, delay)
  }

  private touch(key: string) {
    this.touched.add(key)
    this.scheduleFlush(this.debounceMs)
  }

  private isSettled(part: PartState) {
    return !part.inFlight && !part.conflict && !part.held && !this.touched.has(partKey(part.kind, part.id))
  }

  // ---- Conflicts ------------------------------------------------------------------------------

  resolveConflict(key: string, choice: ConflictChoice) {
    const part = this.parts.get(key)
    if (!part?.conflict) return
    const theirs = part.remote
    const base = part.conflict.base
    part.conflict = null
    part.held = false
    if (choice === 'theirs') {
      this.deck.apply(part.kind, part.id, theirs.data)
      part.base = theirs
      this.afterRemoteApply(part)
    } else {
      const mine = this.deck.read(part.kind, part.id)
      const result = choice === 'merge' ? mergeKeepingBoth(base, mine, theirs.data) : mine
      part.base = theirs
      if (!sameData(result, mine)) {
        this.deck.apply(part.kind, part.id, result)
        this.afterRemoteApply(part)
      }
      this.touched.add(key)
      this.scheduleFlush(0)
    }
    this.emit()
  }

  // ---- The index ------------------------------------------------------------------------------

  /** Section order: the cloud's, then sections only this device has so far. */
  private sectionOrder(): string[] {
    const listed = this.index?.sectionOrder ?? []
    const local = this.deck.ids().sectionOrder
    return [...listed, ...local.filter((id) => !listed.includes(id))]
  }

  private noteIndexMembership(part: PartState) {
    const index = this.index
    if (!index) return
    const pending = this.pendingIndex
    const [listed, add, remove] =
      part.kind === 'section'
        ? [index.sectionOrder, pending.addSections, pending.removeSections]
        : [index.boxIds, pending.addBoxes, pending.removeBoxes]
    const inIndex = (listed.includes(part.id) && !remove.includes(part.id)) || add.includes(part.id)
    const drop = (list: string[]) => {
      const at = list.indexOf(part.id)
      if (at >= 0) list.splice(at, 1)
    }
    if (part.base.data !== null && !inIndex) {
      drop(remove)
      if (!listed.includes(part.id)) add.push(part.id)
    } else if (part.base.data === null && inIndex) {
      drop(add)
      if (listed.includes(part.id)) remove.push(part.id)
    }
  }

  private hasPendingIndex() {
    const p = this.pendingIndex
    return p.addSections.length + p.removeSections.length + p.addBoxes.length + p.removeBoxes.length > 0
  }

  private flushIndex() {
    if (this.indexInFlight || this.indexRetryHandle || !this.hasPendingIndex() || !this.writable) return
    const change = this.pendingIndex
    this.pendingIndex = { addSections: [], removeSections: [], addBoxes: [], removeBoxes: [] }
    this.indexInFlight = true
    this.transport.updateIndex(change).then(
      () => {
        this.indexInFlight = false
        this.flushIndex()
        this.emit()
      },
      () => {
        this.indexInFlight = false
        const p = this.pendingIndex
        this.pendingIndex = {
          addSections: [...change.addSections, ...p.addSections],
          removeSections: [...change.removeSections, ...p.removeSections],
          addBoxes: [...change.addBoxes, ...p.addBoxes],
          removeBoxes: [...change.removeBoxes, ...p.removeBoxes],
        }
        this.indexRetryHandle = this.timers.set(() => {
          this.indexRetryHandle = null
          this.flushIndex()
        }, 5000)
        this.emit()
      },
    )
  }

  // ---- History --------------------------------------------------------------------------------

  /** The deck as the server has it, as far as this device knows. */
  confirmedSnapshot(): DeckSnapshot {
    const snapshot: DeckSnapshot = { sectionOrder: [], sections: {}, boxes: {} }
    for (const id of this.sectionOrder()) {
      const data = this.parts.get(partKey('section', id))?.base.data
      if (data) {
        snapshot.sectionOrder.push(id)
        snapshot.sections[id] = data as SectionData
      }
    }
    for (const part of this.parts.values()) {
      if (part.kind === 'box' && part.base.data) snapshot.boxes[part.id] = part.base.data as BoxData
    }
    return snapshot
  }

  private maybeSnapshot() {
    const index = this.index
    if (!index || !this.writable || this.snapshotInFlight) return
    const now = this.timers.now()
    if (now - index.lastSnapshotAt < SNAPSHOT_INTERVAL_MS || now - this.lastSnapshotTry < 60_000) return
    this.lastSnapshotTry = now
    this.snapshotInFlight = true
    // Another device may save the same snapshot first; then the rules refuse this one, which is fine.
    this.transport
      .saveSnapshot(index.snapshotSeq + 1, this.confirmedSnapshot(), index.revision)
      .catch(() => {})
      .finally(() => {
        this.snapshotInFlight = false
      })
  }

  /**
   * Makes the deck match a saved version. Every part it touches gets a new revision, so history is
   * kept and anyone editing sees the change like any other.
   */
  async restore(snapshot: DeckSnapshot): Promise<void> {
    if (!this.writable || !this.ready) throw new Error('Sign in to restore a version.')
    if ([...this.parts.values()].some((part) => part.conflict)) throw new Error('Settle the open conflict first.')
    this.restoring = true
    this.emit()
    try {
      await this.waitForSaves()
      for (let attempt = 0; ; attempt++) {
        const writes = await this.restoreWrites(snapshot)
        try {
          await this.transport.writeDeck(writes, { sectionOrder: snapshot.sectionOrder, boxIds: Object.keys(snapshot.boxes) }, false)
        } catch (error) {
          // Someone saved a part in the meantime. Look again and retry with the new revisions.
          if (attempt < 2 && error instanceof SyncError && error.reason === 'refused') {
            for (const write of writes) {
              const part = this.parts.get(partKey(write.kind, write.id))
              if (part) part.loaded = false
            }
            continue
          }
          throw error
        }
        for (const write of writes) {
          const part = this.watch(write.kind, write.id)
          part.base = { revision: write.revision, data: write.data }
          if (part.remote.revision < write.revision) part.remote = part.base
          part.loaded = true
        }
        this.deck.replaceAll(snapshot)
        this.lastSavedAt = this.timers.now()
        return
      }
    } finally {
      this.restoring = false
      this.emit()
    }
  }

  private async restoreWrites(snapshot: DeckSnapshot): Promise<PartWrite[]> {
    const wanted = new Map<string, PartData | null>()
    for (const part of this.parts.values()) wanted.set(partKey(part.kind, part.id), null)
    for (const id of this.index?.sectionOrder ?? []) wanted.set(partKey('section', id), null)
    for (const id of this.index?.boxIds ?? []) wanted.set(partKey('box', id), null)
    for (const [id, data] of Object.entries(snapshot.sections)) wanted.set(partKey('section', id), data)
    for (const [id, data] of Object.entries(snapshot.boxes)) wanted.set(partKey('box', id), data)

    const writes: PartWrite[] = []
    for (const [key, data] of wanted) {
      const { kind, id } = parsePartKey(key)
      let part = this.parts.get(key)
      if (!part || !part.loaded) {
        const latest = await this.transport.fetchPart(kind, id)
        part ??= this.newPart(kind, id)
        part.base = latest
        part.remote = latest
        part.loaded = true
        this.parts.set(key, part)
      }
      if (sameData(data, part.base.data)) continue
      writes.push({ kind, id, data, previous: part.base.data, revision: part.base.revision + 1 })
    }
    return writes
  }

  /** Sends what is waiting, then waits for saves in flight, but no longer than the limit (they may be offline). */
  private waitForSaves(limitMs = 10_000): Promise<void> {
    if (this.flushHandle) {
      this.timers.clear(this.flushHandle)
      this.flushHandle = null
    }
    this.flush()
    const giveUpAt = this.timers.now() + limitMs
    return new Promise((resolve) => {
      const check = () => {
        const busy = [...this.parts.values()].some((part) => part.inFlight) || this.indexInFlight
        if (!busy || this.timers.now() >= giveUpAt) resolve()
        else this.timers.set(check, 100)
      }
      check()
    })
  }

  // ---- Starting a deck ------------------------------------------------------------------------

  /** With no deck in the cloud yet, the first editor to sign in saves the one on screen. */
  private createDeckIfMissing() {
    if (this.index !== null || !this.writable || this.creating) return
    const { sectionOrder, boxIds } = this.deck.ids()
    const writes: PartWrite[] = [
      ...sectionOrder.map((id) => ({ kind: 'section' as const, id, data: this.deck.read('section', id), previous: null, revision: 1 })),
      ...boxIds.map((id) => ({ kind: 'box' as const, id, data: this.deck.read('box', id), previous: null, revision: 1 })),
    ].filter((write) => write.data !== null)
    this.creating = true
    this.emit()
    this.transport
      .writeDeck(writes, { sectionOrder, boxIds: writes.filter((w) => w.kind === 'box').map((w) => w.id) }, true)
      .catch((error: unknown) => {
        // Someone else created it first; the index watcher brings theirs in.
        if (!(error instanceof SyncError && error.reason === 'refused')) {
          this.setProblem(`Couldn't create the deck in the cloud: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      .finally(() => {
        this.creating = false
        this.emit()
      })
  }

  // ---- State ----------------------------------------------------------------------------------

  private setProblem(problem: string | null) {
    this.problem = problem
    this.emit()
  }

  private emit() {
    if (!this.onState) return
    const state = this.state()
    const signature = JSON.stringify(state)
    if (signature === this.lastState) return
    this.lastState = signature
    this.onState(state)
  }
}
