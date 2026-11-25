#!/usr/bin/env node
// One-off: turns the old encrypted deck document into the plain layout the app now reads.
//
//   presentations/{deck}  (ciphertext, iv, salt)   ->   presentations/{deck}               the index
//                                                       presentations/{deck}/sections/{id}
//                                                       presentations/{deck}/boxes/{id}
//                                                       presentations/{deck}/versions/1    a first snapshot
//
// Before it writes anything, it saves the old encrypted document as it is: to a local file under
// backups/ (git ignores it) and to migrationBackups/{deck}-{time} in Firestore, which the rules let no
// client read. It uses the Firebase Admin SDK with your own credentials, which are never stored here.
//
// Usage (dry run first: it decrypts, checks and reports, and writes nothing):
//   gcloud auth application-default login            # or GOOGLE_APPLICATION_CREDENTIALS=/path/key.json
//   node tools/migrate-plaintext.mjs --project anxiety-brain-deck --dry-run
//   node tools/migrate-plaintext.mjs --project anxiety-brain-deck
//
// The decryption key is the old VITE_DECK_ENCRYPTION_KEY. Pass it in LEGACY_DECK_KEY, or leave that
// unset and type it when asked (it is not echoed):
//   read -s "LEGACY_DECK_KEY?Old deck key: "; echo; export LEGACY_DECK_KEY
//
// Options: --project <id> (required), --deck <id> (default anxiety-deck), --dry-run,
//          --backup-dir <path> (default backups).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

// ---- Must match src/sync/schema.ts and firestore.rules ---------------------------------------------

export const SCHEMA_VERSION = 2
const ID = /^[A-Za-z0-9_-]{1,64}$/
const REGIONS = new Set(['amygdala', 'hippocampus', 'caudate', 'putamen', 'pallidum', 'thalamus', 'dlpfc', 'ofc', 'acc', 'insula'])
const LIMITS = { textLength: 5000, titleLength: 200, slidesPerSection: 30, sections: 60, boxes: 2000, boxSize: 200, snapshotJsonLength: 900_000 }
const STYLES = new Set(['title', 'heading', 'body', 'small'])
const COLORS = new Set(['white', 'grey', 'black'])
const LOOKS = new Set(['clear', 'frosted'])
const UPDATED_BY = 'migrate-plaintext'

// ---- Decrypting the old envelope (AES-256-GCM, key from PBKDF2-SHA-256, as the app used to) --------

const PBKDF2_ITERATIONS = 100_000
const fromBase64 = (text) => Uint8Array.from(Buffer.from(text, 'base64'))

export async function decryptEnvelope(envelope, passphrase) {
  const { subtle } = globalThis.crypto
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(envelope.salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ciphertext))
  return JSON.parse(new TextDecoder().decode(plain))
}

// ---- Building the new documents --------------------------------------------------------------------

const clamp = (value, low, high) => Math.min(Math.max(value, low), high)

/**
 * The new deck from the old decrypted payload ({ sections, boxes, format }). Returns what to write,
 * plus any problems that must be fixed first (nothing is written while there are any).
 */
export function buildDeck(payload) {
  const problems = []
  const skipped = []
  const sections = Array.isArray(payload?.sections) ? payload.sections : []
  const boxes = Array.isArray(payload?.boxes) ? payload.boxes : []
  if (sections.length === 0) problems.push('The decrypted deck has no sections.')
  if (sections.length > LIMITS.sections) problems.push(`${sections.length} sections; the limit is ${LIMITS.sections}.`)

  const sectionDocs = {}
  const snapshotSections = {}
  const sectionOrder = []
  const slideIds = new Set()
  for (const section of sections) {
    const where = `Section "${section?.title ?? section?.id}"`
    if (!ID.test(section?.id ?? '')) problems.push(`${where} has an id the rules do not accept: ${JSON.stringify(section?.id)}.`)
    if (sectionDocs[section.id]) problems.push(`${where}: the id ${section.id} is used twice.`)
    const title = String(section.title ?? '').trim()
    if (!title || title.length > LIMITS.titleLength) problems.push(`${where}: its title must be 1 to ${LIMITS.titleLength} characters.`)
    const slides = Array.isArray(section.slides) ? section.slides : []
    if (slides.length < 1 || slides.length > LIMITS.slidesPerSection) {
      problems.push(`${where} has ${slides.length} slides; it needs 1 to ${LIMITS.slidesPerSection}.`)
    }
    const cleanSlides = slides.map((slide) => {
      if (!ID.test(slide?.id ?? '')) problems.push(`${where} has a slide id the rules do not accept: ${JSON.stringify(slide?.id)}.`)
      const slideTitle = String(slide.title ?? '')
      if (slideTitle.length > LIMITS.titleLength) problems.push(`${where}: slide "${slideTitle.slice(0, 30)}…" has a title over ${LIMITS.titleLength} characters.`)
      slideIds.add(slide.id)
      const regions = (slide.focus?.regions ?? []).filter((region) => REGIONS.has(region))
      const circuits = (slide.focus?.circuits ?? []).includes('cstc') ? ['cstc'] : []
      return { id: slide.id, title: slideTitle, focus: { regions, circuits }, ...(slide.side === 'left' && { side: 'left' }) }
    })
    const backdrop = ['purple', 'pink', 'black'].includes(section.backdrop) ? section.backdrop : 'blue'
    const cursorEffect = section.cursorEffect === 'ripple' || section.cursorEffect === 'off' ? section.cursorEffect : undefined
    const particles = section.particles === 'sparkle' ? 'sparkle' : undefined
    const content = { title, backdrop, ...(cursorEffect && { cursorEffect }), ...(particles && { particles }) }
    sectionDocs[section.id] = {
      ...content,
      slideIds: cleanSlides.map((s) => s.id),
      slideTitles: cleanSlides.map((s) => s.title),
      slideRegions: cleanSlides.map((s) => s.focus.regions.join(',')),
      slideCircuits: cleanSlides.map((s) => s.focus.circuits.join(',')),
      ...(cleanSlides.some((s) => s.side === 'left') && { slideSides: cleanSlides.map((s) => (s.side === 'left' ? 'left' : '')) }),
      deleted: false,
    }
    snapshotSections[section.id] = { ...content, slides: cleanSlides }
    sectionOrder.push(section.id)
  }

  const boxDocs = {}
  for (const box of boxes) {
    const where = `Text box ${JSON.stringify(box?.id)}`
    const text = typeof box?.text === 'string' ? box.text : ''
    // The app never saved boxes left empty, so neither does this.
    if (!text.trim()) {
      skipped.push(box?.id)
      continue
    }
    if (!ID.test(box.id ?? '')) problems.push(`${where} has an id the rules do not accept.`)
    if (boxDocs[box.id]) problems.push(`${where}: the id is used twice.`)
    if (text.length > LIMITS.textLength) problems.push(`${where} has ${text.length} characters; the limit is ${LIMITS.textLength}.`)
    if (!ID.test(box.slide ?? '')) problems.push(`${where} is on a slide with an id the rules do not accept.`)
    const doc = {
      slide: box.slide,
      text,
      x: clamp(Number(box.x) || 0, 0, 1),
      y: clamp(Number(box.y) || 0, 0, 1),
      style: STYLES.has(box.style) ? box.style : 'body',
      color: COLORS.has(box.color) ? box.color : 'white',
      look: LOOKS.has(box.look) ? box.look : 'clear',
      deleted: false,
    }
    if (typeof box.width === 'number' && box.width >= 1) doc.width = Math.min(box.width, LIMITS.boxSize)
    if (typeof box.height === 'number' && box.height >= 1) doc.height = Math.min(box.height, LIMITS.boxSize)
    boxDocs[box.id] = doc
  }
  const boxIds = Object.keys(boxDocs)
  if (boxIds.length > LIMITS.boxes) problems.push(`${boxIds.length} text boxes; the limit is ${LIMITS.boxes}.`)
  const orphans = boxIds.filter((id) => !slideIds.has(boxDocs[id].slide))

  const snapshotBoxes = Object.fromEntries(boxIds.map((id) => [id, (({ deleted: _deleted, ...box }) => box)(boxDocs[id])]))
  const snapshotJson = JSON.stringify({ sectionOrder, sections: snapshotSections, boxes: snapshotBoxes })
  if (snapshotJson.length > LIMITS.snapshotJsonLength) problems.push('The deck is too large for a saved version.')

  return { sectionOrder, sectionDocs, boxIds, boxDocs, snapshotJson, skipped, orphans, problems }
}

// ---- Running it ------------------------------------------------------------------------------------

function summarize(deck, log) {
  const slides = Object.values(deck.sectionDocs).reduce((sum, section) => sum + section.slideIds.length, 0)
  const characters = Object.values(deck.boxDocs).reduce((sum, box) => sum + box.text.length, 0)
  log(`  Sections:   ${deck.sectionOrder.length} (${slides} slides)`)
  for (const id of deck.sectionOrder) {
    const section = deck.sectionDocs[id]
    const count = Object.values(deck.boxDocs).filter((box) => section.slideIds.includes(box.slide)).length
    log(`    - ${section.title}: ${section.slideIds.length} slides, ${count} text boxes`)
  }
  log(`  Text boxes: ${deck.boxIds.length} (${characters.toLocaleString()} characters)`)
  if (deck.skipped.length) log(`  Skipped:    ${deck.skipped.length} empty text boxes`)
  if (deck.orphans.length) log(`  Note:       ${deck.orphans.length} text boxes are on slides that no longer exist (kept, but not shown)`)
  log(`  Version 1:  ${(deck.snapshotJson.length / 1024).toFixed(1)} kB`)
}

/**
 * Migrates one deck. `db` is an Admin SDK Firestore; FieldValue is passed in so tests and the CLI
 * share one copy of firebase-admin.
 */
export async function migrate({ db, FieldValue, deckId, key, dryRun, backupDir, log = console.log, now = new Date() }) {
  const ref = db.collection('presentations').doc(deckId)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new Error(`There is no presentations/${deckId} document.`)
  const old = snapshot.data()
  if (old.schemaVersion === SCHEMA_VERSION && !('ciphertext' in old)) {
    log(`presentations/${deckId} is already plain data (schema ${SCHEMA_VERSION}). Nothing to do.`)
    return { status: 'already-migrated' }
  }
  for (const field of ['ciphertext', 'iv', 'salt']) {
    if (typeof old[field] !== 'string' || !old[field]) throw new Error(`presentations/${deckId} has no ${field}; it is not the old encrypted deck.`)
  }

  let payload
  try {
    payload = await decryptEnvelope(old, key)
  } catch {
    throw new Error('Could not decrypt the deck: the key is wrong, or the data is damaged. Nothing was written.')
  }

  const deck = buildDeck(payload)
  log(`\nDecrypted presentations/${deckId}${dryRun ? ' (dry run: nothing will be written)' : ''}:`)
  summarize(deck, log)
  if (deck.problems.length) {
    log('\nThese must be fixed before migrating. Nothing was written:')
    for (const problem of deck.problems) log(`  - ${problem}`)
    return { status: 'problems', deck }
  }
  if (dryRun) {
    log('\nDry run finished. Run again without --dry-run to migrate.')
    return { status: 'dry-run', deck }
  }

  // 1. Keep the old document exactly as it was, twice over.
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const backupId = `${deckId}-${stamp}`
  const backup = { ...old, updatedAt: old.updatedAt?.toDate?.().toISOString?.() ?? old.updatedAt ?? null }
  mkdirSync(backupDir, { recursive: true })
  const backupFile = join(backupDir, `${backupId}.json`)
  writeFileSync(backupFile, `${JSON.stringify({ path: `presentations/${deckId}`, savedAt: now.toISOString(), data: backup }, null, 2)}\n`, {
    flag: 'wx',
  })
  await db.collection('migrationBackups').doc(backupId).create({ path: `presentations/${deckId}`, savedAt: now, data: old })
  log(`\nSaved the encrypted original to ${backupFile} and migrationBackups/${backupId}.`)

  // 2. Write the plain deck: parts first, then the index and the first version, all in one batch
  //    when it fits (a deck this size does).
  const stampFields = (revision) => ({ schemaVersion: SCHEMA_VERSION, revision, updatedAt: FieldValue.serverTimestamp(), updatedBy: UPDATED_BY })
  const writes = [
    ...deck.sectionOrder.map((id) => [ref.collection('sections').doc(id), deck.sectionDocs[id]]),
    ...deck.boxIds.map((id) => [ref.collection('boxes').doc(id), deck.boxDocs[id]]),
  ]
  // Parts left over from an earlier, interrupted run keep counting up from their revision.
  const existing = await db.getAll(...writes.map(([docRef]) => docRef))
  const revisionOf = new Map(existing.map((doc) => [doc.ref.path, doc.exists ? Number(doc.get('revision')) || 0 : 0]))

  const batches = []
  for (let i = 0; i < writes.length; i += 450) batches.push(writes.slice(i, i + 450))
  for (const [i, chunk] of batches.entries()) {
    const batch = db.batch()
    for (const [docRef, data] of chunk) batch.set(docRef, { ...data, ...stampFields(revisionOf.get(docRef.path) + 1) })
    if (i === batches.length - 1) {
      batch.set(ref.collection('versions').doc('1'), {
        ...stampFields(1),
        seq: 1,
        deckRevision: 1,
        sectionCount: deck.sectionOrder.length,
        boxCount: deck.boxIds.length,
        deckJson: deck.snapshotJson,
      })
      // set() without merge replaces the old document, so the ciphertext fields are gone.
      batch.set(ref, {
        ...stampFields(1),
        sectionOrder: deck.sectionOrder,
        boxIds: deck.boxIds,
        snapshotSeq: 1,
        lastSnapshotAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }
  log(`Wrote ${deck.sectionOrder.length} sections, ${deck.boxIds.length} text boxes, the index, and version 1.`)
  log('Done. Open the deck to check it, then remove VITE_DECK_ENCRYPTION_KEY from every .env.')
  return { status: 'migrated', deck, backupFile, backupId }
}

function parseArgs(argv) {
  const options = { deck: 'anxiety-deck', dryRun: false, backupDir: 'backups', project: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--project') options.project = argv[++i]
    else if (arg === '--deck') options.deck = argv[++i]
    else if (arg === '--backup-dir') options.backupDir = argv[++i]
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

/** Asks for the key without echoing it. */
function askHidden(question) {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolvePromise(answer)
    })
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.project) {
    console.log('Usage: node tools/migrate-plaintext.mjs --project <firebase-project-id> [--deck anxiety-deck] [--dry-run] [--backup-dir backups]')
    process.exit(options.help ? 0 : 1)
  }
  let key = process.env.LEGACY_DECK_KEY
  if (!key && process.stdin.isTTY) key = await askHidden('Old deck key (VITE_DECK_ENCRYPTION_KEY): ')
  if (!key) throw new Error('No key. Set LEGACY_DECK_KEY or run this in a terminal to be asked for it.')

  const { initializeApp, applicationDefault } = await import('firebase-admin/app')
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore')
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  initializeApp({ projectId: options.project, ...(!usingEmulator && { credential: applicationDefault() }) })
  console.log(`Project ${options.project}${usingEmulator ? ` (emulator at ${process.env.FIRESTORE_EMULATOR_HOST})` : ''}, deck ${options.deck}.`)
  const result = await migrate({
    db: getFirestore(),
    FieldValue,
    deckId: options.deck,
    key,
    dryRun: options.dryRun,
    backupDir: resolve(options.backupDir),
  })
  process.exit(result.status === 'problems' ? 2 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
}
