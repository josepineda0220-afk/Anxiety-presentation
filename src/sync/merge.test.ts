import { describe, expect, it } from 'vitest'
import { combineText, mergeKeepingBoth, threeWayMerge } from './merge'
import type { BoxData, SectionData } from './schema'

const box = (patch: Partial<BoxData> = {}): BoxData => ({
  slide: 's1',
  text: 'Base',
  x: 0.1,
  y: 0.1,
  style: 'body',
  color: 'white',
  look: 'clear',
  ...patch,
})

const slide = (id: string, title = id) => ({ id, title, focus: { regions: [], circuits: [] } })
const section = (slides: ReturnType<typeof slide>[], patch: Partial<SectionData> = {}): SectionData => ({
  title: 'Section',
  backdrop: 'blue',
  slides,
  ...patch,
})

describe('threeWayMerge', () => {
  it('takes whichever side changed when only one did', () => {
    expect(threeWayMerge(box(), box({ text: 'Mine' }), box())).toEqual({ merged: box({ text: 'Mine' }), conflicts: [] })
    expect(threeWayMerge(box(), box(), box({ text: 'Theirs' }))).toEqual({ merged: box({ text: 'Theirs' }), conflicts: [] })
  })

  it('combines different fields changed on each side', () => {
    const result = threeWayMerge(box(), box({ text: 'Mine' }), box({ x: 0.6, color: 'grey' }))
    expect(result).toEqual({ merged: box({ text: 'Mine', x: 0.6, color: 'grey' }), conflicts: [] })
  })

  it('is no conflict when both made the same change', () => {
    expect(threeWayMerge(box(), box({ text: 'Same' }), box({ text: 'Same' })).conflicts).toEqual([])
  })

  it('names each field both changed differently', () => {
    const result = threeWayMerge(box(), box({ text: 'Mine', x: 0.2 }), box({ text: 'Theirs', x: 0.3 }))
    expect(result.conflicts.sort()).toEqual(['text', 'x'])
  })

  it('handles an optional field added on one side and left alone on the other', () => {
    expect(threeWayMerge(box(), box({ width: 30 }), box({ text: 'Theirs' }))).toEqual({
      merged: box({ width: 30, text: 'Theirs' }),
      conflicts: [],
    })
    // Cleared here (fit to text), unchanged there: stays cleared.
    expect(threeWayMerge(box({ width: 30 }), box(), box({ width: 30, text: 'T' })).merged).toEqual(box({ text: 'T' }))
  })

  it('treats a removal against a change as a conflict, and against no change as a removal', () => {
    expect(threeWayMerge(box(), null, box({ text: 'Edited' })).conflicts).toEqual(['deleted'])
    expect(threeWayMerge(box(), box({ text: 'Edited' }), null).conflicts).toEqual(['deleted'])
    expect(threeWayMerge(box(), null, box())).toEqual({ merged: null, conflicts: [] })
    expect(threeWayMerge(box(), box(), null)).toEqual({ merged: null, conflicts: [] })
  })

  it('keeps slides each side added to a section', () => {
    const base = section([slide('a')])
    const result = threeWayMerge(base, section([slide('a'), slide('mine')]), section([slide('a'), slide('theirs')]))
    expect(result.conflicts).toEqual([])
    expect((result.merged as SectionData).slides.map((s) => s.id)).toEqual(['a', 'theirs', 'mine'])
  })

  it('merges a slide added on one side with a title change on the other', () => {
    const base = section([slide('a')])
    const result = threeWayMerge(base, section([slide('a'), slide('b')]), section([slide('a')], { title: 'Renamed' }))
    expect(result).toEqual({ merged: section([slide('a'), slide('b')], { title: 'Renamed' }), conflicts: [] })
  })

  it('removes a slide one side removed, but asks if the other side changed it', () => {
    const base = section([slide('a'), slide('b')])
    expect((threeWayMerge(base, section([slide('a')]), section([slide('a'), slide('b'), slide('c')])).merged as SectionData).slides.map((s) => s.id)).toEqual(['a', 'c'])
    const asked = threeWayMerge(base, section([slide('a')]), section([slide('a'), slide('b', 'Retitled')]))
    expect(asked.conflicts).toEqual(['slides'])
    expect((asked.merged as SectionData).slides.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('mergeKeepingBoth', () => {
  it('keeps both texts and everything that merges cleanly', () => {
    const merged = mergeKeepingBoth(box(), box({ text: 'Mine', y: 0.4 }), box({ text: 'Theirs', x: 0.6 }))
    expect(merged).toEqual(box({ text: 'Theirs\n\nMine', x: 0.6, y: 0.4 }))
  })

  it('keeps the part when one side removed it', () => {
    expect(mergeKeepingBoth(box(), null, box({ text: 'Edited' }))).toEqual(box({ text: 'Edited' }))
    expect(mergeKeepingBoth(box(), box({ text: 'Edited' }), null)).toEqual(box({ text: 'Edited' }))
  })
})

describe('combineText', () => {
  it('does not repeat text one version already contains', () => {
    expect(combineText('Fear and worry', 'Fear')).toBe('Fear and worry')
    expect(combineText('Fear', 'Fear and worry')).toBe('Fear and worry')
    expect(combineText('Theirs\n', '\nMine')).toBe('Theirs\n\nMine')
  })
})
