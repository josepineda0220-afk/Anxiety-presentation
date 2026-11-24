import { describe, expect, it } from 'vitest'
import { ALL_SEED_BOXES, SEED_SECTIONS } from '../data/sections'
import {
  LIMITS,
  boxFromDoc,
  boxToData,
  decodeSnapshot,
  deckToSnapshot,
  encodeSnapshot,
  partDocument,
  partProblem,
  sameData,
  sectionFromDoc,
  sectionToData,
  snapshotToDeck,
} from './schema'

describe('stored documents', () => {
  it('round-trips every seed section through its stored shape', () => {
    for (const section of SEED_SECTIONS) {
      const stored = partDocument('section', sectionToData(section), null, 1, 'uid')
      expect(stored).not.toHaveProperty('slides')
      expect(sectionFromDoc(stored)).toEqual(sectionToData(section))
    }
  })

  it('round-trips every seed box', () => {
    for (const box of ALL_SEED_BOXES) {
      expect(boxFromDoc(partDocument('box', boxToData(box), null, 1, 'uid'))).toEqual(boxToData(box))
    }
  })

  it('stamps every document with the schema version, revision and editor', () => {
    expect(partDocument('box', boxToData(ALL_SEED_BOXES[0]), null, 7, 'uid')).toMatchObject({
      schemaVersion: 2,
      revision: 7,
      updatedBy: 'uid',
      deleted: false,
    })
  })

  it('keeps the last content in a removed part, so history can bring it back', () => {
    const previous = boxToData(ALL_SEED_BOXES[0])
    const stored = partDocument('box', null, previous, 3, 'uid')
    expect(stored).toMatchObject({ ...previous, deleted: true })
    expect(boxFromDoc(stored)).toBeNull()
  })

  it('keeps boxes on screen and sizes within what the rules accept', () => {
    const box = { ...ALL_SEED_BOXES[0], x: -0.2, y: 1.4, width: 260, height: 0 }
    expect(boxToData(box)).toMatchObject({ x: 0, y: 1, width: LIMITS.boxSize })
    expect(boxToData(box)).not.toHaveProperty('height')
  })

  it('leaves out the default cursor effect, so a saved section and the same one on screen compare equal', () => {
    const section = { ...SEED_SECTIONS[0], cursorEffect: 'part' as const }
    expect(sectionToData(section)).not.toHaveProperty('cursorEffect')
    expect(sameData(sectionToData(section), sectionToData(SEED_SECTIONS[0]))).toBe(true)
  })

  it('saves sparkle dots and the pink and black backdrops, and reads them back', () => {
    expect(sectionToData({ ...SEED_SECTIONS[0], particles: 'plain' })).not.toHaveProperty('particles')
    for (const backdrop of ['pink', 'black'] as const) {
      const data = sectionToData({ ...SEED_SECTIONS[0], backdrop, particles: 'sparkle' })
      expect(sectionFromDoc(data)).toMatchObject({ backdrop, particles: 'sparkle' })
    }
    expect(sectionFromDoc({ ...sectionToData(SEED_SECTIONS[0]), backdrop: 'green' })).toBeNull()
  })
})

describe('partProblem', () => {
  it('explains text that is too long, and passes text at the limit', () => {
    const box = boxToData(ALL_SEED_BOXES[0])
    expect(partProblem('box', { ...box, text: 'x'.repeat(LIMITS.textLength) })).toBeNull()
    expect(partProblem('box', { ...box, text: 'x'.repeat(LIMITS.textLength + 1) })).toMatch(/5,000/)
  })

  it('explains a section with no title or too many slides', () => {
    const section = sectionToData(SEED_SECTIONS[0])
    expect(partProblem('section', { ...section, title: ' ' })).toMatch(/title/)
    const slides = Array.from({ length: 31 }, (_, i) => ({ ...section.slides[0], id: `s${i}` }))
    expect(partProblem('section', { ...section, slides })).toMatch(/30 slides/)
  })
})

describe('snapshots', () => {
  it('round-trips the whole seed deck, in order, dropping empty boxes', () => {
    const boxes = [...ALL_SEED_BOXES, { ...ALL_SEED_BOXES[0], id: 'empty', text: '  ' }]
    const snapshot = deckToSnapshot(SEED_SECTIONS, boxes)
    expect(snapshot.boxes).not.toHaveProperty('empty')
    const decoded = decodeSnapshot(encodeSnapshot(snapshot))!
    expect(decoded).toEqual(snapshot)
    const deck = snapshotToDeck(decoded)
    expect(deck.sections.map((s) => s.id)).toEqual(SEED_SECTIONS.map((s) => s.id))
    expect(deck.boxes).toHaveLength(ALL_SEED_BOXES.length)
  })

  it('stays well under the size limit for a version', () => {
    expect(encodeSnapshot(deckToSnapshot(SEED_SECTIONS, ALL_SEED_BOXES)).length).toBeLessThan(LIMITS.snapshotJsonLength / 10)
  })

  it('rejects something that is not a snapshot', () => {
    expect(decodeSnapshot('not json')).toBeNull()
    expect(decodeSnapshot('{"sections":[]}')).toBeNull()
  })
})
