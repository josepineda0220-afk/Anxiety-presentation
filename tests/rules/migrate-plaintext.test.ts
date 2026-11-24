/**
 * Runs tools/migrate-plaintext.mjs against the Firestore emulator (npm run test:rules), then checks
 * the result through the real rules, as the app would read and edit it.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, deleteApp, type App } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { ALL_SEED_BOXES, SEED_SECTIONS } from '../../src/data/sections'
import { boxFromDoc, boxToData, decodeSnapshot, partDocument, sectionFromDoc, sectionToData } from '../../src/sync/schema'
import { encryptLikeTheOldApp } from '../support/legacyEnvelope'
import { migrate } from '../../tools/migrate-plaintext.mjs'

const PROJECT_ID = 'demo-anxiety-deck'
const EDITOR_UID = 'editor-uid'
const KEY = 'the-old-key'
const payload = { sections: SEED_SECTIONS, boxes: ALL_SEED_BOXES, format: { style: 'body', color: 'white', look: 'clear' } }

let admin: App
let db: AdminFirestore
let env: RulesTestEnvironment
let backupDir: string
const quiet = () => {}

beforeAll(async () => {
  admin = initializeApp({ projectId: PROJECT_ID }, 'migration-test')
  db = getFirestore(admin)
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8').replace("'REPLACE_WITH_EDITOR_UID'", `'${EDITOR_UID}'`)
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } })
})

afterAll(async () => {
  await env?.cleanup()
  if (admin) await deleteApp(admin)
})

beforeEach(async () => {
  await env.clearFirestore()
  backupDir = mkdtempSync(join(tmpdir(), 'deck-backups-'))
  const envelope = await encryptLikeTheOldApp(payload, KEY)
  await db.doc('presentations/anxiety-deck').set({ ...envelope, updatedAt: FieldValue.serverTimestamp() })
})

const run = (options: { key?: string; dryRun?: boolean } = {}) =>
  migrate({ db, FieldValue, deckId: 'anxiety-deck', key: options.key ?? KEY, dryRun: options.dryRun ?? false, backupDir, log: quiet })

const editor = () => env.authenticatedContext(EDITOR_UID).firestore() as unknown as Firestore

describe('the migration', () => {
  it('writes nothing on a dry run', async () => {
    const result = await run({ dryRun: true })
    expect(result.status).toBe('dry-run')
    const index = await db.doc('presentations/anxiety-deck').get()
    expect(index.get('ciphertext')).toBeTypeOf('string')
    expect((await db.collection('presentations/anxiety-deck/boxes').get()).size).toBe(0)
    expect((await db.collection('migrationBackups').get()).size).toBe(0)
    expect(readdirSync(backupDir)).toEqual([])
  })

  it('writes nothing with the wrong key', async () => {
    await expect(run({ key: 'wrong' })).rejects.toThrow(/Nothing was written/)
    expect((await db.doc('presentations/anxiety-deck').get()).get('ciphertext')).toBeTypeOf('string')
    expect(readdirSync(backupDir)).toEqual([])
  })

  it('saves the encrypted original first, then the plain deck the app reads', async () => {
    const original = (await db.doc('presentations/anxiety-deck').get()).data()!
    const result = await run()
    expect(result.status).toBe('migrated')

    // The backups hold the original, untouched.
    const [backupDoc] = (await db.collection('migrationBackups').get()).docs
    expect(backupDoc.get('data.ciphertext')).toBe(original.ciphertext)
    const [file] = readdirSync(backupDir)
    expect(JSON.parse(readFileSync(join(backupDir, file), 'utf8')).data.ciphertext).toBe(original.ciphertext)

    // The index replaced the envelope.
    const index = (await db.doc('presentations/anxiety-deck').get()).data()!
    expect(index).not.toHaveProperty('ciphertext')
    expect(index).toMatchObject({ schemaVersion: 2, revision: 1, snapshotSeq: 1, sectionOrder: SEED_SECTIONS.map((s) => s.id) })
    expect(index.boxIds).toHaveLength(ALL_SEED_BOXES.length)

    // Anyone can read each part, and it is what the app would have saved.
    const viewer = env.unauthenticatedContext().firestore() as unknown as Firestore
    const section = await assertSucceeds(getDoc(doc(viewer, 'presentations/anxiety-deck/sections/sec-8')))
    expect(sectionFromDoc(section.data())).toEqual(sectionToData(SEED_SECTIONS.find((s) => s.id === 'sec-8')!))
    const box = ALL_SEED_BOXES[3]
    const stored = await assertSucceeds(getDoc(doc(viewer, `presentations/anxiety-deck/boxes/${box.id}`)))
    expect(boxFromDoc(stored.data())).toEqual(boxToData(box))

    // Version 1 holds the whole deck.
    const version = (await db.doc('presentations/anxiety-deck/versions/1').get()).data()!
    expect(decodeSnapshot(version.deckJson)!.sectionOrder).toEqual(SEED_SECTIONS.map((s) => s.id))
  })

  it('leaves a deck the editor can keep editing under the rules', async () => {
    await run()
    const box = ALL_SEED_BOXES[0]
    const edit = { ...partDocument('box', { ...boxToData(box), text: 'Edited after migrating' }, null, 2, EDITOR_UID), updatedAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(editor(), `presentations/anxiety-deck/boxes/${box.id}`), edit))
    // A second save still based on revision 1 is refused.
    const stale = { ...partDocument('box', boxToData(box), null, 2, EDITOR_UID), updatedAt: serverTimestamp() }
    await assertFails(setDoc(doc(editor(), `presentations/anxiety-deck/boxes/${box.id}`), stale))
  })

  it('does nothing the second time', async () => {
    await run()
    expect((await run()).status).toBe('already-migrated')
    expect((await db.collection('migrationBackups').get()).size).toBe(1)
  })
})
