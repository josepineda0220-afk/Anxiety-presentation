/**
 * Firestore rules tests. They run against the emulator only:
 *   npm run test:rules
 * which starts it with a demo project id, so they can never reach a real Firebase project.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { SEED_SECTIONS, ALL_SEED_BOXES } from '../../src/data/sections'
import {
  SCHEMA_VERSION,
  boxToData,
  deckToSnapshot,
  encodeSnapshot,
  partDocument,
  sectionToData,
  storedContent,
} from '../../src/sync/schema'

const PROJECT_ID = 'demo-anxiety-deck'
const EDITOR_UID = 'editor-uid'
const EDITOR_EMAIL = 'editors@anxiety-presentation.invalid'
const DECK = 'presentations/anxiety-deck'

const rulesSource = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')

let env: RulesTestEnvironment

beforeAll(async () => {
  expect(rulesSource).toContain("'REPLACE_WITH_EDITOR_UID'")
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: rulesSource.replace("'REPLACE_WITH_EDITOR_UID'", `'${EDITOR_UID}'`) },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

const editor = (): Firestore => env.authenticatedContext(EDITOR_UID, { email: EDITOR_EMAIL }).firestore() as unknown as Firestore
const stranger = (): Firestore => env.authenticatedContext('someone-else', { email: EDITOR_EMAIL }).firestore() as unknown as Firestore
const anonymous = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore

const sampleBox = boxToData(ALL_SEED_BOXES[0])
const sampleSection = sectionToData(SEED_SECTIONS[1])

const boxDoc = (revision: number, overrides: Record<string, unknown> = {}, uid = EDITOR_UID) => ({
  ...partDocument('box', sampleBox, null, revision, uid),
  updatedAt: serverTimestamp(),
  ...overrides,
})

const sectionDoc = (revision: number, overrides: Record<string, unknown> = {}) => ({
  ...partDocument('section', sampleSection, null, revision, EDITOR_UID),
  updatedAt: serverTimestamp(),
  ...overrides,
})

/** The stored slide lists for a section with this many slides, each lighting every kind of focus. */
const slidesOf = (count: number) =>
  storedContent('section', {
    ...sampleSection,
    slides: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      title: `Slide ${i}`,
      focus: { regions: ['amygdala', 'insula', 'acc'], circuits: i % 2 ? ['cstc'] : [] },
    })),
  } as typeof sampleSection) as Record<string, string[]>

const indexDoc = (revision: number, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  revision,
  updatedAt: serverTimestamp(),
  updatedBy: EDITOR_UID,
  sectionOrder: ['sec-1'],
  boxIds: ['box-1'],
  snapshotSeq: 0,
  lastSnapshotAt: serverTimestamp(),
  ...overrides,
})

/** Writes documents as they would already be on the server, past the rules. */
async function seed(docs: Record<string, Record<string, unknown>>) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore
    for (const [path, data] of Object.entries(docs)) await setDoc(doc(db, path), data)
  })
}

const minutesAgo = (minutes: number) => Timestamp.fromMillis(Date.now() - minutes * 60_000)

/** A stored index whose last snapshot was some minutes ago. */
const seedIndex = (minutes = 10, overrides: Record<string, unknown> = {}) =>
  seed({
    [DECK]: {
      ...indexDoc(3),
      updatedAt: minutesAgo(minutes),
      lastSnapshotAt: minutesAgo(minutes),
      snapshotSeq: 2,
      ...overrides,
    },
  })

const versionDoc = (seq: number, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 1,
  updatedAt: serverTimestamp(),
  updatedBy: EDITOR_UID,
  seq,
  deckRevision: 3,
  sectionCount: 9,
  boxCount: ALL_SEED_BOXES.length,
  deckJson: encodeSnapshot(deckToSnapshot(SEED_SECTIONS, ALL_SEED_BOXES)),
  ...overrides,
})

/** The batch the app writes for a snapshot: the version, plus the index bump that names it. */
function snapshotBatch(db: Firestore, seq: number, version = versionDoc(seq), indexPatch: Record<string, unknown> = {}) {
  const batch = writeBatch(db)
  batch.set(doc(db, `${DECK}/versions/${seq}`), version)
  batch.update(doc(db, DECK), {
    snapshotSeq: seq,
    lastSnapshotAt: serverTimestamp(),
    revision: increment(1),
    updatedAt: serverTimestamp(),
    updatedBy: EDITOR_UID,
    ...indexPatch,
  })
  return batch.commit()
}

describe('reading', () => {
  beforeEach(async () => {
    await seedIndex()
    await seed({
      [`${DECK}/boxes/box-1`]: { ...boxDoc(1), updatedAt: minutesAgo(1) },
      [`${DECK}/sections/sec-1`]: { ...sectionDoc(1), updatedAt: minutesAgo(1) },
      [`${DECK}/versions/1`]: { ...versionDoc(1), updatedAt: minutesAgo(20) },
    })
  })

  it('lets anyone read the index, a section and a box one document at a time', async () => {
    const db = anonymous()
    await assertSucceeds(getDoc(doc(db, DECK)))
    await assertSucceeds(getDoc(doc(db, `${DECK}/sections/sec-1`)))
    await assertSucceeds(getDoc(doc(db, `${DECK}/boxes/box-1`)))
  })

  it('lets nobody list presentations, sections or boxes, not even the editor', async () => {
    for (const db of [anonymous(), editor()]) {
      await assertFails(getDocs(collection(db, 'presentations')))
      await assertFails(getDocs(collection(db, `${DECK}/sections`)))
      await assertFails(getDocs(collection(db, `${DECK}/boxes`)))
    }
  })

  it('lets only the editor read and list versions', async () => {
    await assertFails(getDoc(doc(anonymous(), `${DECK}/versions/1`)))
    await assertFails(getDocs(collection(anonymous(), `${DECK}/versions`)))
    await assertFails(getDocs(collection(stranger(), `${DECK}/versions`)))
    await assertSucceeds(getDoc(doc(editor(), `${DECK}/versions/1`)))
    await assertSucceeds(getDocs(collection(editor(), `${DECK}/versions`)))
  })

  it('refuses any path outside the deck, including the migration backups', async () => {
    await assertFails(getDoc(doc(anonymous(), 'secrets/anything')))
    await assertFails(setDoc(doc(editor(), 'secrets/anything'), { a: 1 }))
    await assertFails(getDoc(doc(editor(), 'migrationBackups/anxiety-deck-2026')))
    await assertFails(getDocs(collection(editor(), 'migrationBackups')))
  })
})

describe('who may write', () => {
  it('lets the editor create a box', async () => {
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1)))
  })

  it('refuses a signed-out visitor', async () => {
    await assertFails(setDoc(doc(anonymous(), `${DECK}/boxes/box-1`), boxDoc(1, { updatedBy: 'nobody' })))
  })

  it('refuses the wrong account, even one with the editor email', async () => {
    await assertFails(setDoc(doc(stranger(), `${DECK}/boxes/box-1`), boxDoc(1, {}, 'someone-else')))
  })

  it('refuses a write that names someone else in updatedBy', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { updatedBy: 'someone-else' })))
  })

  it('refuses a client-chosen updatedAt instead of the server time', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { updatedAt: Timestamp.now() })))
  })

  it('refuses an unknown schema version', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { schemaVersion: 1 })))
  })
})

describe('revisions', () => {
  beforeEach(async () => {
    await seed({ [`${DECK}/boxes/box-1`]: { ...boxDoc(4), updatedAt: minutesAgo(1) } })
  })

  it('accepts a save that raises the revision by exactly one', async () => {
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(5, { text: 'Edited' })))
  })

  it('refuses a stale save that repeats the current revision', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(4, { text: 'Edited' })))
  })

  it('refuses a save based on an older revision', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(3, { text: 'Edited' })))
  })

  it('refuses a save that skips ahead', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(6, { text: 'Edited' })))
  })

  it('refuses a new box that does not start at revision 1', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-2`), boxDoc(2)))
  })

  it('refuses a revision that is not a whole number', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(5.5)))
  })

  it('refuses a partial update that leaves the revision alone', async () => {
    await assertFails(updateDoc(doc(editor(), `${DECK}/boxes/box-1`), { text: 'Sneaky', updatedAt: serverTimestamp() }))
  })
})

describe('document shape', () => {
  it('refuses an extra field', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { owner: 'me' })))
  })

  it('refuses a missing field', async () => {
    const { look: _look, ...withoutLook } = boxDoc(1) as Record<string, unknown>
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), withoutLook))
  })

  it('refuses a field of the wrong type or value', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { x: 'left' })))
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { style: 'huge' })))
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { deleted: 'no' })))
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { x: 1.5 })))
  })

  it('accepts a removed box saved as deleted, since removing is a save, not a delete', async () => {
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { deleted: true })))
  })

  it('accepts optional width and length within limits', async () => {
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { width: 44, height: 12.5 })))
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-2`), boxDoc(1, { width: 500 })))
  })

  it('refuses a document id the app would never make', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/${'x'.repeat(65)}`), boxDoc(1)))
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/bad.id`), boxDoc(1)))
  })

  it('accepts a section exactly as the app saves it', async () => {
    for (const section of SEED_SECTIONS) {
      const data = { ...partDocument('section', sectionToData(section), null, 1, EDITOR_UID), updatedAt: serverTimestamp() }
      await assertSucceeds(setDoc(doc(editor(), `${DECK}/sections/${section.id}`), data))
    }
  })

  it('accepts every seed box exactly as the app saves it', async () => {
    const db = editor()
    const batch = writeBatch(db)
    for (const box of ALL_SEED_BOXES) {
      batch.set(doc(db, `${DECK}/boxes/${box.id}`), {
        ...partDocument('box', boxToData(box), null, 1, EDITOR_UID),
        updatedAt: serverTimestamp(),
      })
    }
    await assertSucceeds(batch.commit())
  })

  it('refuses a slide with an unknown brain region, a stray circuit, or lists that do not line up', async () => {
    const one = slidesOf(1)
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, { ...one, slideRegions: ['spleen'] })))
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, { ...one, slideCircuits: ['loop'] })))
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, { ...one, slideTitles: ['a', 'b'] })))
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, { ...one, slideRegions: [7] })))
  })

  it('refuses a section with the old nested slides field', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, { slides: sampleSection.slides })))
  })

  it('checks every slide of the largest section allowed, down to the last one', async () => {
    const thirty = slidesOf(30)
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, thirty)))
    const badLast = { ...thirty, slideTitles: [...thirty.slideTitles.slice(0, 29), 'x'.repeat(201)] }
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-2`), sectionDoc(1, badLast)))
    // Titles are capped together too, so line breaks cannot smuggle in more text.
    const overLines = { ...thirty, slideTitles: [...thirty.slideTitles.slice(0, 29), `one\n${'x'.repeat(200)}`] }
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-3`), sectionDoc(1, overLines)))
  })
})

describe('size caps', () => {
  it('accepts text at the limit and refuses text over it', async () => {
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { text: 'a'.repeat(5000) })))
    await assertFails(setDoc(doc(editor(), `${DECK}/boxes/box-2`), boxDoc(1, { text: 'a'.repeat(5001) })))
  })

  it('counts characters, not bytes, so accented text and emoji get the same room the app allows', async () => {
    // The app checks text.length (UTF-16 units), which is never less than the rules' count.
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-1`), boxDoc(1, { text: 'é'.repeat(5000) })))
    await assertSucceeds(setDoc(doc(editor(), `${DECK}/boxes/box-2`), boxDoc(1, { text: '🧠'.repeat(2500) })))
  })

  it('refuses a section with too many slides, or none', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, slidesOf(31))))
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-2`), sectionDoc(1, slidesOf(0))))
  })

  it('refuses an oversized section title', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/sections/sec-1`), sectionDoc(1, { title: 't'.repeat(201) })))
  })

  it('refuses an index with too many boxes or a bad id in its lists', async () => {
    const tooMany = Array.from({ length: 2001 }, (_, i) => `b${i}`)
    await assertFails(setDoc(doc(editor(), DECK), indexDoc(1, { boxIds: tooMany })))
    await assertFails(setDoc(doc(editor(), DECK), indexDoc(1, { boxIds: ['ok', 'not ok'] })))
    await assertFails(setDoc(doc(editor(), DECK), indexDoc(1, { boxIds: ['x'.repeat(10_000)] })))
    await assertFails(setDoc(doc(editor(), DECK), indexDoc(1, { boxIds: ['dup', 'dup'] })))
  })

  it('refuses an oversized version', async () => {
    await seedIndex()
    await assertFails(snapshotBatch(editor(), 3, versionDoc(3, { deckJson: 'x'.repeat(900_001) })))
  })
})

describe('the index', () => {
  it('lets the editor create it at revision 1 with no versions yet', async () => {
    await assertSucceeds(setDoc(doc(editor(), DECK), indexDoc(1)))
  })

  it('refuses a create that claims a snapshot already happened', async () => {
    await assertFails(setDoc(doc(editor(), DECK), indexDoc(1, { snapshotSeq: 5 })))
  })

  it('merges list changes through arrayUnion while still raising the revision by one', async () => {
    await seedIndex()
    await assertSucceeds(
      updateDoc(doc(editor(), DECK), {
        boxIds: arrayUnion('box-2'),
        revision: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: EDITOR_UID,
      }),
    )
  })

  it('refuses an index write with a stale revision', async () => {
    await seedIndex()
    await assertFails(
      updateDoc(doc(editor(), DECK), { boxIds: ['box-2'], revision: 3, updatedAt: serverTimestamp(), updatedBy: EDITOR_UID }),
    )
  })

  it('refuses moving the snapshot bookkeeping without saving a version', async () => {
    await seedIndex()
    await assertFails(
      updateDoc(doc(editor(), DECK), {
        snapshotSeq: 3,
        lastSnapshotAt: serverTimestamp(),
        revision: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: EDITOR_UID,
      }),
    )
  })
})

describe('snapshot timing', () => {
  it('saves a version once 5 minutes have passed since the last one', async () => {
    await seedIndex(5)
    await assertSucceeds(snapshotBatch(editor(), 3))
  })

  it('refuses a version 1 minute after the last one', async () => {
    await seedIndex(1)
    await assertFails(snapshotBatch(editor(), 3))
  })

  it('refuses a version on its own, without the index bump', async () => {
    await seedIndex()
    await assertFails(setDoc(doc(editor(), `${DECK}/versions/3`), versionDoc(3)))
  })

  it('refuses a version whose number is not the next one', async () => {
    await seedIndex()
    await assertFails(snapshotBatch(editor(), 5))
    await assertFails(snapshotBatch(editor(), 3, versionDoc(4)))
  })

  it('refuses a second version saved right after the first', async () => {
    await seedIndex()
    await assertSucceeds(snapshotBatch(editor(), 3))
    await assertFails(snapshotBatch(editor(), 4))
  })

  it('refuses a version from the wrong account', async () => {
    await seedIndex()
    await assertFails(snapshotBatch(stranger(), 3, versionDoc(3, { updatedBy: 'someone-else' }), { updatedBy: 'someone-else' }))
  })
})

describe('nothing can be deleted or rewritten', () => {
  beforeEach(async () => {
    await seedIndex()
    await seed({
      [`${DECK}/boxes/box-1`]: { ...boxDoc(1), updatedAt: minutesAgo(1) },
      [`${DECK}/sections/sec-1`]: { ...sectionDoc(1), updatedAt: minutesAgo(1) },
      [`${DECK}/versions/2`]: { ...versionDoc(2), updatedAt: minutesAgo(20) },
    })
  })

  it('refuses deleting a box, a section, the index or a version, even for the editor', async () => {
    const db = editor()
    await assertFails(deleteDoc(doc(db, `${DECK}/boxes/box-1`)))
    await assertFails(deleteDoc(doc(db, `${DECK}/sections/sec-1`)))
    await assertFails(deleteDoc(doc(db, DECK)))
    await assertFails(deleteDoc(doc(db, `${DECK}/versions/2`)))
  })

  it('refuses editing a saved version', async () => {
    await assertFails(setDoc(doc(editor(), `${DECK}/versions/2`), versionDoc(2, { revision: 2, deckJson: '{}' })))
    await assertFails(updateDoc(doc(editor(), `${DECK}/versions/2`), { deckJson: '{}' }))
  })
})

describe('restoring a version', () => {
  it('writes the restored parts as new revisions in one batch, leaving history alone', async () => {
    await seedIndex()
    await seed({
      [`${DECK}/boxes/box-1`]: { ...boxDoc(7, { text: 'Current' }), updatedAt: minutesAgo(1) },
      [`${DECK}/versions/2`]: { ...versionDoc(2), updatedAt: minutesAgo(20) },
    })
    const db = editor()
    const batch = writeBatch(db)
    batch.set(doc(db, `${DECK}/boxes/box-1`), boxDoc(8, { text: 'From version 2' }))
    batch.update(doc(db, DECK), {
      sectionOrder: ['sec-1'],
      boxIds: ['box-1'],
      revision: increment(1),
      updatedAt: serverTimestamp(),
      updatedBy: EDITOR_UID,
    })
    await assertSucceeds(batch.commit())
    const version = await getDoc(doc(db, `${DECK}/versions/2`))
    expect(version.exists()).toBe(true)
  })
})
