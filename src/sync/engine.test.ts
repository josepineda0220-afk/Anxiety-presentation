import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncEngine, SyncError, type IndexChange, type LocalDeck, type PartWrite, type SyncTransport } from './engine'
import {
  SNAPSHOT_INTERVAL_MS,
  partKey,
  type BoxData,
  type DeckIndex,
  type DeckSnapshot,
  type PartData,
  type PartKind,
  type RemotePart,
  type SectionData,
} from './schema'

// ---- A fake Firestore that enforces the same revision rule as firestore.rules ------------------

class FakeServer {
  parts = new Map<string, RemotePart>()
  index: DeckIndex | null = null
  versions: { seq: number; snapshot: DeckSnapshot }[] = []
  writes: PartWrite[] = []
  /** While set, writes wait until release() is called. */
  holdWrites = false
  /** While set, writes fail as if the network were down. */
  offline = false
  /** The most writes to one part that were ever on their way at once. */
  maxInFlightPerPart = 0
  private inFlight = new Map<string, number>()
  private held: (() => void)[] = []
  private partWatchers = new Map<string, Set<(part: RemotePart) => void>>()
  private indexWatchers = new Set<(index: DeckIndex | null) => void>()

  release() {
    const held = this.held
    this.held = []
    for (const go of held) go()
  }

  get(kind: PartKind, id: string): RemotePart {
    return structuredClone(this.parts.get(partKey(kind, id)) ?? { revision: 0, data: null })
  }

  /** Someone else's save, straight to the server. */
  put(kind: PartKind, id: string, data: PartData | null) {
    const current = this.get(kind, id)
    this.apply({ kind, id, data, previous: current.data, revision: current.revision + 1 })
  }

  setIndex(index: DeckIndex | null) {
    this.index = index && structuredClone(index)
    for (const watcher of this.indexWatchers) queueMicrotask(() => watcher(structuredClone(this.index)))
  }

  private apply(write: PartWrite) {
    const key = partKey(write.kind, write.id)
    const current = this.parts.get(key)?.revision ?? 0
    if (write.revision !== current + 1) throw new SyncError('refused', 'stale revision')
    const part = { revision: write.revision, data: structuredClone(write.data) }
    this.parts.set(key, part)
    this.writes.push(structuredClone(write))
    for (const watcher of this.partWatchers.get(key) ?? []) queueMicrotask(() => watcher(structuredClone(part)))
  }

  transport(): SyncTransport {
    return {
      watchIndex: (onIndex) => {
        this.indexWatchers.add(onIndex)
        queueMicrotask(() => onIndex(structuredClone(this.index)))
        return () => this.indexWatchers.delete(onIndex)
      },
      watchPart: (kind, id, onPart) => {
        const key = partKey(kind, id)
        const set = this.partWatchers.get(key) ?? new Set()
        set.add(onPart)
        this.partWatchers.set(key, set)
        queueMicrotask(() => onPart(this.get(kind, id)))
        return () => set.delete(onPart)
      },
      fetchPart: async (kind, id) => this.get(kind, id),
      writePart: (write) =>
        new Promise<void>((resolve, reject) => {
          const key = partKey(write.kind, write.id)
          const count = (this.inFlight.get(key) ?? 0) + 1
          this.inFlight.set(key, count)
          this.maxInFlightPerPart = Math.max(this.maxInFlightPerPart, count)
          const go = () => {
            this.inFlight.set(key, this.inFlight.get(key)! - 1)
            if (this.offline) return reject(new SyncError('retry', 'offline'))
            try {
              this.apply(write)
              resolve()
            } catch (error) {
              reject(error)
            }
          }
          if (this.holdWrites) this.held.push(go)
          else queueMicrotask(go)
        }),
      updateIndex: async (change: IndexChange) => {
        if (this.offline) throw new SyncError('retry', 'offline')
        const index = this.index!
        const union = (list: string[], add: string[], remove: string[]) => [
          ...list.filter((id) => !remove.includes(id)),
          ...add.filter((id) => !list.includes(id)),
        ]
        this.setIndex({
          ...index,
          revision: index.revision + 1,
          sectionOrder: union(index.sectionOrder, change.addSections, change.removeSections),
          boxIds: union(index.boxIds, change.addBoxes, change.removeBoxes),
        })
      },
      saveSnapshot: async (seq, snapshot) => {
        const index = this.index!
        if (seq !== index.snapshotSeq + 1 || Date.now() - index.lastSnapshotAt < 4 * 60_000) {
          throw new SyncError('refused', 'too soon')
        }
        this.versions.push({ seq, snapshot: structuredClone(snapshot) })
        this.setIndex({ ...index, revision: index.revision + 1, snapshotSeq: seq, lastSnapshotAt: Date.now() })
      },
      writeDeck: async (writes, lists, create) => {
        if (create && this.index) throw new SyncError('refused', 'exists')
        for (const write of writes) {
          const current = this.parts.get(partKey(write.kind, write.id))?.revision ?? 0
          if (write.revision !== current + 1) throw new SyncError('refused', 'stale revision')
        }
        for (const write of writes) this.apply(write)
        this.setIndex({
          revision: (this.index?.revision ?? 0) + 1,
          sectionOrder: lists.sectionOrder,
          boxIds: lists.boxIds,
          snapshotSeq: this.index?.snapshotSeq ?? 0,
          lastSnapshotAt: this.index?.lastSnapshotAt ?? Date.now(),
        })
      },
    }
  }
}

// ---- A fake deck on one device ----------------------------------------------------------------

class FakeDeck implements LocalDeck {
  sections = new Map<string, SectionData>()
  order: string[] = []
  boxes = new Map<string, BoxData>()
  editing: string | null = null
  engine!: SyncEngine

  read(kind: PartKind, id: string): PartData | null {
    const value = kind === 'section' ? this.sections.get(id) : this.boxes.get(id)
    return value ? structuredClone(value) : null
  }

  apply(kind: PartKind, id: string, data: PartData | null) {
    if (kind === 'box') {
      if (data) this.boxes.set(id, structuredClone(data as BoxData))
      else this.boxes.delete(id)
      return
    }
    if (data) {
      this.sections.set(id, structuredClone(data as SectionData))
      if (!this.order.includes(id)) this.order.push(id)
    } else {
      this.sections.delete(id)
      this.order = this.order.filter((other) => other !== id)
    }
  }

  replaceAll(snapshot: DeckSnapshot) {
    this.sections = new Map(Object.entries(structuredClone(snapshot.sections)))
    this.order = [...snapshot.sectionOrder]
    this.boxes = new Map(Object.entries(structuredClone(snapshot.boxes)))
  }

  orderSections(order: string[]) {
    this.order = [...order.filter((id) => this.sections.has(id)), ...this.order.filter((id) => !order.includes(id))]
  }

  ids() {
    return { sectionOrder: [...this.order], boxIds: [...this.boxes.keys()] }
  }

  editingKey() {
    return this.editing
  }

  /** What a person does: change a box, then the store tells the engine. */
  editBox(id: string, patch: Partial<BoxData>) {
    this.boxes.set(id, { ...this.boxes.get(id)!, ...patch })
    this.engine.localChanged([partKey('box', id)])
  }

  addBox(id: string, box: BoxData) {
    this.boxes.set(id, box)
    this.engine.localChanged([partKey('box', id)])
  }

  removeBox(id: string) {
    this.boxes.delete(id)
    this.engine.localChanged([partKey('box', id)])
  }

  text(id: string) {
    return this.boxes.get(id)?.text
  }
}

// ---- Helpers ----------------------------------------------------------------------------------

const box = (text: string, extra: Partial<BoxData> = {}): BoxData => ({
  slide: 's1',
  text,
  x: 0.1,
  y: 0.2,
  style: 'body',
  color: 'white',
  look: 'clear',
  ...extra,
})

const section = (title: string): SectionData => ({
  title,
  backdrop: 'blue',
  slides: [{ id: 's1', title: 'One', focus: { regions: [], circuits: [] } }],
})

let server: FakeServer

/** A server with one section and two boxes saved. */
function seedServer() {
  server = new FakeServer()
  server.put('section', 'sec1', section('Intro'))
  server.put('box', 'b1', box('Fear'))
  server.put('box', 'b2', box('Worry'))
  server.setIndex({ revision: 1, sectionOrder: ['sec1'], boxIds: ['b1', 'b2'], snapshotSeq: 0, lastSnapshotAt: Date.now() })
  server.writes = []
}

/** A device: a deck, an engine, signed in unless told otherwise. */
async function device({ writable = true } = {}) {
  const deck = new FakeDeck()
  deck.boxes.set('local-seed', box('Only on this screen'))
  const engine = new SyncEngine(server.transport(), deck)
  deck.engine = engine
  engine.start()
  engine.setWritable(writable)
  await settle()
  return { deck, engine }
}

/** Lets watchers fire and the save debounce run out. */
const settle = async (ms = 1000) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  seedServer()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---- Tests ------------------------------------------------------------------------------------

describe('loading the deck', () => {
  it('shows the cloud deck in place of what was on screen, once every part has arrived', async () => {
    const { deck, engine } = await device()
    expect(engine.state().phase).toBe('ready')
    expect(deck.ids()).toEqual({ sectionOrder: ['sec1'], boxIds: ['b1', 'b2'] })
    expect(deck.text('b1')).toBe('Fear')
  })

  it('lets a viewer see the deck without ever writing', async () => {
    const { deck, engine } = await device({ writable: false })
    deck.editBox('b1', { text: 'Not allowed' })
    await settle()
    expect(server.writes).toHaveLength(0)
    expect(engine.state().saving).toBe(false)
  })

  it('stays view-only with a reason when the cloud deck cannot be read, then loads once it can', async () => {
    const transport = server.transport()
    let deliver: ((index: DeckIndex | null) => void) | null = null
    const deck = new FakeDeck()
    const engine = new SyncEngine(
      {
        ...transport,
        watchIndex: (onIndex, onError) => {
          deliver = onIndex
          queueMicrotask(() => onError(new Error('The cloud deck is in the old format.')))
          return () => {}
        },
      },
      deck,
    )
    deck.engine = engine
    engine.start()
    engine.setWritable(true)
    await settle()
    expect(engine.state()).toMatchObject({ phase: 'connecting', problem: expect.stringMatching(/old format/) })
    expect(server.writes).toHaveLength(0)
    deliver!(structuredClone(server.index))
    await settle()
    expect(engine.state()).toMatchObject({ phase: 'ready', problem: null })
  })

  it('creates the deck from the one on screen when the cloud has none and an editor signs in', async () => {
    server = new FakeServer()
    const deck = new FakeDeck()
    deck.sections.set('sec1', section('Intro'))
    deck.order = ['sec1']
    deck.boxes.set('b1', box('Seed'))
    const engine = new SyncEngine(server.transport(), deck)
    deck.engine = engine
    engine.start()
    await settle()
    expect(engine.state().phase).toBe('missing')
    engine.setWritable(true)
    await settle()
    expect(server.index).toMatchObject({ sectionOrder: ['sec1'], boxIds: ['b1'] })
    expect(server.get('box', 'b1')).toEqual({ revision: 1, data: box('Seed') })
    expect(engine.state().phase).toBe('ready')
  })
})

describe('saving', () => {
  it('saves a box once typing pauses, raising its revision by one', async () => {
    const { deck } = await device()
    deck.editBox('b1', { text: 'Fe' })
    deck.editBox('b1', { text: 'Fear and' })
    await settle(100)
    expect(server.writes).toHaveLength(0)
    await settle()
    expect(server.writes).toEqual([{ kind: 'box', id: 'b1', data: box('Fear and'), previous: box('Fear'), revision: 2 }])
  })

  it('keeps saving during a long stretch of typing', async () => {
    const { deck } = await device()
    for (let i = 0; i < 12; i++) {
      deck.editBox('b1', { text: `Fear ${i}` })
      await settle(400)
    }
    expect(server.writes.length).toBeGreaterThanOrEqual(1)
  })

  it('never has two saves of one part in flight, so a later one cannot skip over someone else', async () => {
    const { deck } = await device()
    server.holdWrites = true
    deck.editBox('b1', { text: 'First' })
    await settle()
    deck.editBox('b1', { text: 'Second' })
    await settle()
    server.release()
    await settle()
    server.holdWrites = false
    server.release()
    await settle()
    expect(server.maxInFlightPerPart).toBe(1)
    expect(server.writes.map((w) => [w.revision, (w.data as BoxData).text])).toEqual([
      [2, 'First'],
      [3, 'Second'],
    ])
  })

  it('saves a new box at revision 1 and lists it in the index', async () => {
    const { deck } = await device()
    deck.addBox('b3', box('Panic'))
    await settle()
    expect(server.get('box', 'b3')).toEqual({ revision: 1, data: box('Panic') })
    expect(server.index!.boxIds).toEqual(['b1', 'b2', 'b3'])
  })

  it('saves a removed box as a removal, keeping its document, and drops it from the index', async () => {
    const { deck } = await device()
    deck.removeBox('b2')
    await settle()
    expect(server.get('box', 'b2')).toEqual({ revision: 2, data: null })
    expect(server.writes[0].previous).toEqual(box('Worry'))
    expect(server.index!.boxIds).toEqual(['b1'])
  })

  it('refuses to send a box over the size limit and says why', async () => {
    const { deck, engine } = await device()
    deck.editBox('b1', { text: 'x'.repeat(5001) })
    await settle()
    expect(server.writes).toHaveLength(0)
    expect(engine.state().problem).toMatch(/5,000 characters/)
  })

  it('tries again after a network failure', async () => {
    const { deck, engine } = await device()
    server.offline = true
    deck.editBox('b1', { text: 'Offline edit' })
    await settle()
    expect(engine.state().saving).toBe(true)
    server.offline = false
    await settle(5000)
    expect(server.get('box', 'b1').data).toEqual(box('Offline edit'))
    expect(engine.state().saving).toBe(false)
  })
})

describe('two people editing', () => {
  it('lands edits to different boxes from both devices, and each sees the other', async () => {
    const a = await device()
    const b = await device()
    a.deck.editBox('b1', { text: 'Fear, by A' })
    b.deck.editBox('b2', { text: 'Worry, by B' })
    await settle()
    expect(server.get('box', 'b1').data).toEqual(box('Fear, by A'))
    expect(server.get('box', 'b2').data).toEqual(box('Worry, by B'))
    expect(a.deck.text('b2')).toBe('Worry, by B')
    expect(b.deck.text('b1')).toBe('Fear, by A')
  })

  it('merges changes to different fields of one box without asking', async () => {
    const a = await device()
    const b = await device()
    server.holdWrites = true
    a.deck.editBox('b1', { text: 'Fear, by A' })
    b.deck.editBox('b1', { x: 0.5 })
    await settle()
    server.holdWrites = false
    server.release()
    await settle(3000)
    expect(server.get('box', 'b1').data).toEqual(box('Fear, by A', { x: 0.5 }))
    expect(a.deck.boxes.get('b1')).toEqual(box('Fear, by A', { x: 0.5 }))
    expect(b.deck.boxes.get('b1')).toEqual(box('Fear, by A', { x: 0.5 }))
    expect(a.engine.state().conflicts).toEqual([])
    expect(b.engine.state().conflicts).toEqual([])
  })

  it('asks instead of overwriting when both change the same text', async () => {
    const a = await device()
    const b = await device()
    server.holdWrites = true
    a.deck.editBox('b1', { text: 'Fear, by A' })
    b.deck.editBox('b1', { text: 'Fear, by B' })
    await settle()
    server.holdWrites = false
    server.release()
    await settle(3000)
    // A saved first. B's save was refused, and B is asked rather than overwriting A.
    expect(server.get('box', 'b1')).toEqual({ revision: 2, data: box('Fear, by A') })
    const [conflict] = b.engine.state().conflicts
    expect(conflict).toMatchObject({ key: 'box:b1', fields: ['text'], mine: box('Fear, by B'), theirs: box('Fear, by A') })
    expect(b.engine.state().saving).toBe(false)
    return { a, b }
  })

  async function conflicted() {
    const a = await device()
    const b = await device()
    server.holdWrites = true
    a.deck.editBox('b1', { text: 'Fear, by A' })
    b.deck.editBox('b1', { text: 'Fear, by B' })
    await settle()
    server.holdWrites = false
    server.release()
    await settle(3000)
    return { a, b }
  }

  it('reloads theirs when asked', async () => {
    const { b } = await conflicted()
    b.engine.resolveConflict('box:b1', 'theirs')
    await settle()
    expect(b.deck.text('b1')).toBe('Fear, by A')
    expect(server.get('box', 'b1').revision).toBe(2)
    expect(b.engine.state().conflicts).toEqual([])
  })

  it('keeps mine when asked, as a new revision on top of theirs', async () => {
    const { a, b } = await conflicted()
    b.engine.resolveConflict('box:b1', 'mine')
    await settle()
    expect(server.get('box', 'b1')).toEqual({ revision: 3, data: box('Fear, by B') })
    expect(a.deck.text('b1')).toBe('Fear, by B')
  })

  it('keeps both texts when asked to merge', async () => {
    const { a, b } = await conflicted()
    b.engine.resolveConflict('box:b1', 'merge')
    await settle()
    expect(server.get('box', 'b1')).toEqual({ revision: 3, data: box('Fear, by A\n\nFear, by B') })
    expect(a.deck.text('b1')).toBe('Fear, by A\n\nFear, by B')
  })

  it('asks when one person removes a box the other changed', async () => {
    const a = await device()
    const b = await device()
    server.holdWrites = true
    a.deck.removeBox('b1')
    b.deck.editBox('b1', { text: 'Still needed' })
    await settle()
    server.holdWrites = false
    server.release()
    await settle(3000)
    expect(b.engine.state().conflicts[0]).toMatchObject({ fields: ['deleted'], theirs: null })
    b.engine.resolveConflict('box:b1', 'mine')
    await settle()
    expect(server.get('box', 'b1')).toEqual({ revision: 3, data: box('Still needed') })
    expect(server.index!.boxIds).toContain('b1')
  })

  it('notices a stale save even before the other change has arrived', async () => {
    const { deck, engine } = await device()
    // Someone else's save that this device has not heard about yet.
    server.parts.set(partKey('box', 'b1'), { revision: 2, data: box('Changed elsewhere') })
    deck.editBox('b1', { text: 'Changed here' })
    await settle(3000)
    expect(engine.state().conflicts[0]).toMatchObject({ key: 'box:b1', theirs: box('Changed elsewhere') })
    expect(server.get('box', 'b1').data).toEqual(box('Changed elsewhere'))
  })
})

describe('the box you are typing in', () => {
  it('is never changed by someone else while you type, and is looked at again when you stop', async () => {
    const { deck, engine } = await device()
    deck.editing = 'box:b1'
    server.put('box', 'b1', box('Remote text'))
    await settle()
    expect(deck.text('b1')).toBe('Fear')
    expect(engine.state().held).toBe(1)
    deck.editing = null
    engine.editingStopped('box:b1')
    await settle()
    expect(deck.text('b1')).toBe('Remote text')
    expect(engine.state().held).toBe(0)
  })

  it('turns into a question once you stop, if you both changed the text', async () => {
    const { deck, engine } = await device()
    deck.editing = 'box:b1'
    server.put('box', 'b1', box('Remote text'))
    await settle()
    deck.editBox('b1', { text: 'My text' })
    await settle(5000)
    expect(server.get('box', 'b1').data).toEqual(box('Remote text'))
    expect(deck.text('b1')).toBe('My text')
    deck.editing = null
    engine.editingStopped('box:b1')
    await settle()
    expect(engine.state().conflicts[0]).toMatchObject({ mine: box('My text'), theirs: box('Remote text') })
  })

  it('still applies changes to other boxes while you type', async () => {
    const { deck } = await device()
    deck.editing = 'box:b1'
    server.put('box', 'b2', box('Worry, edited elsewhere'))
    await settle()
    expect(deck.text('b2')).toBe('Worry, edited elsewhere')
  })
})

describe('live updates from others', () => {
  it('adds boxes and sections that someone else creates, in their order', async () => {
    const { deck } = await device({ writable: false })
    server.put('section', 'sec2', section('Second'))
    server.put('box', 'b9', box('New elsewhere'))
    server.setIndex({ ...server.index!, sectionOrder: ['sec1', 'sec2'], boxIds: ['b1', 'b2', 'b9'] })
    await settle()
    expect(deck.order).toEqual(['sec1', 'sec2'])
    expect(deck.text('b9')).toBe('New elsewhere')
  })

  it('removes a box someone else removed', async () => {
    const { deck } = await device({ writable: false })
    server.put('box', 'b2', null)
    server.setIndex({ ...server.index!, boxIds: ['b1'] })
    await settle()
    expect(deck.boxes.has('b2')).toBe(false)
  })
})

describe('history', () => {
  it('saves a snapshot after about 5 minutes of editing, and not before', async () => {
    const { deck } = await device()
    deck.editBox('b1', { text: 'Early edit' })
    await settle()
    expect(server.versions).toHaveLength(0)
    await settle(SNAPSHOT_INTERVAL_MS)
    deck.editBox('b1', { text: 'Later edit' })
    await settle()
    expect(server.versions).toHaveLength(1)
    expect(server.versions[0].seq).toBe(1)
    expect(server.versions[0].snapshot.boxes.b1.text).toBe('Later edit')
    deck.editBox('b1', { text: 'Right after' })
    await settle()
    expect(server.versions).toHaveLength(1)
  })

  it('restores a version as new revisions of each part, removing parts added since', async () => {
    const { deck, engine } = await device()
    const old: DeckSnapshot = { sectionOrder: ['sec1'], sections: { sec1: section('Intro') }, boxes: { b1: box('Old fear') } }
    deck.addBox('b3', box('Added later'))
    await settle()
    await engine.restore(old)
    await settle()
    expect(server.get('box', 'b1')).toEqual({ revision: 2, data: box('Old fear') })
    expect(server.get('box', 'b2')).toEqual({ revision: 2, data: null })
    expect(server.get('box', 'b3')).toEqual({ revision: 2, data: null })
    expect(server.index!.boxIds).toEqual(['b1'])
    expect(deck.ids().boxIds).toEqual(['b1'])
    // The section was unchanged, so it was left alone.
    expect(server.get('section', 'sec1').revision).toBe(1)
  })

  it('brings back a box that was removed before the version was taken… or after', async () => {
    const { deck, engine } = await device()
    deck.removeBox('b2')
    await settle()
    await engine.restore({
      sectionOrder: ['sec1'],
      sections: { sec1: section('Intro') },
      boxes: { b1: box('Fear'), b2: box('Worry') },
    })
    await settle()
    expect(server.get('box', 'b2')).toEqual({ revision: 3, data: box('Worry') })
    expect(deck.text('b2')).toBe('Worry')
  })
})
