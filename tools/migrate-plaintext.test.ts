import { describe, expect, it } from 'vitest'
import { ALL_SEED_BOXES, SEED_SECTIONS } from '../src/data/sections'
import { boxFromDoc, boxToData, decodeSnapshot, deckToSnapshot, sectionFromDoc, sectionToData } from '../src/sync/schema'
import { encryptLikeTheOldApp } from '../tests/support/legacyEnvelope'
import { buildDeck, decryptEnvelope } from './migrate-plaintext.mjs'

const payload = { sections: SEED_SECTIONS, boxes: ALL_SEED_BOXES, format: { style: 'body', color: 'white', look: 'clear' } }

describe('decrypting the old deck', () => {
  it('reads what the old app encrypted', async () => {
    const envelope = await encryptLikeTheOldApp(payload, 'the-old-key')
    expect(await decryptEnvelope(envelope, 'the-old-key')).toEqual(JSON.parse(JSON.stringify(payload)))
  })

  it('fails on the wrong key', async () => {
    const envelope = await encryptLikeTheOldApp(payload, 'the-old-key')
    await expect(decryptEnvelope(envelope, 'not-the-key')).rejects.toThrow()
  })
})

describe('building the plain deck', () => {
  const deck = buildDeck(payload)

  it('writes exactly what the app would save for every section and box', () => {
    expect(deck.problems).toEqual([])
    expect(deck.sectionOrder).toEqual(SEED_SECTIONS.map((s) => s.id))
    for (const section of SEED_SECTIONS) expect(sectionFromDoc(deck.sectionDocs[section.id])).toEqual(sectionToData(section))
    for (const box of ALL_SEED_BOXES) expect(boxFromDoc(deck.boxDocs[box.id])).toEqual(boxToData(box))
  })

  it('makes a first version the app can restore', () => {
    expect(decodeSnapshot(deck.snapshotJson)).toEqual(deckToSnapshot(SEED_SECTIONS, ALL_SEED_BOXES))
  })

  it('leaves out empty boxes, as the app always did', () => {
    const withEmpty = buildDeck({ ...payload, boxes: [...ALL_SEED_BOXES, { ...ALL_SEED_BOXES[0], id: 'blank', text: '  ' }] })
    expect(withEmpty.skipped).toEqual(['blank'])
    expect(withEmpty.boxIds).not.toContain('blank')
  })

  it('stops on anything the rules would refuse, before writing', () => {
    const bad = buildDeck({
      sections: [{ ...SEED_SECTIONS[0], id: 'bad id' }],
      boxes: [{ ...ALL_SEED_BOXES[0], text: 'x'.repeat(5001) }],
    })
    expect(bad.problems.join('\n')).toMatch(/id the rules do not accept/)
    expect(bad.problems.join('\n')).toMatch(/5001 characters/)
    expect(buildDeck({ boxes: [] }).problems).toContain('The decrypted deck has no sections.')
  })
})
