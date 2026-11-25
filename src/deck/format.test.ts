import { describe, expect, it } from 'vitest'
import {
  charFormats,
  editFormats,
  formattedLines,
  pickFormat,
  shownFormat,
  withFormats,
  type FormattedText,
  type TextCursor,
} from './format'

const box = (text: string, patch: Partial<FormattedText> = {}): FormattedText => ({ text, style: 'body', color: 'white', ...patch })
const at = (start: number, end = start): TextCursor => ({ start, end })

/** Applies a pick the way the store does, keeping the text. */
function pick(before: FormattedText, cursor: TextCursor | null, change: Parameters<typeof pickFormat>[2]) {
  const picked = pickFormat(before, cursor, change)
  return { box: { ...before, ...picked.formats }, cursor: picked.cursor }
}

/** Types over the cursor the way the browser does. */
function type(before: FormattedText, cursor: TextCursor, typed: string) {
  const text = before.text.slice(0, cursor.start) + typed + before.text.slice(cursor.end)
  const caret = cursor.start + typed.length
  return { box: { ...before, text, ...editFormats(before, text, { caret, cursor }) }, cursor: at(caret) }
}

describe('storing formats', () => {
  it('keeps no lists for text in one size and colour', () => {
    expect(withFormats('Fear', box(''), charFormats(box('Fear', { style: 'title' })))).toEqual({
      style: 'title',
      color: 'white',
      sizes: undefined,
      colors: undefined,
    })
  })

  it('lists only the stretches that differ from the base, and reads them back', () => {
    const picked = pick(box('Fear and worry'), at(0, 4), { style: 'heading' }).box
    const both = pick(picked, at(9, 14), { color: 'grey' }).box
    expect(both).toMatchObject({ style: 'body', sizes: 'h0-4', color: 'white', colors: 'g9-14' })
    expect(charFormats(both)[0]).toEqual({ style: 'heading', color: 'white' })
    expect(charFormats(both)[10]).toEqual({ style: 'body', color: 'grey' })
  })

  it('ignores a list it cannot read, and stretches past the end of the text', () => {
    const chars = charFormats(box('abc', { sizes: 'nonsense,q0-1,t2-99', colors: 'k' }))
    expect(chars.map((c) => c.style)).toEqual(['body', 'body', 'title'])
    expect(chars.map((c) => c.color)).toEqual(['white', 'white', 'white'])
  })

  it('never splits an emoji', () => {
    const picked = pick(box('a😀b'), at(0, 2), { color: 'black' }).box
    expect(picked.colors).toBe('k0-3')
  })
})

describe('picking a size or colour', () => {
  it('changes only the selected text', () => {
    const { box: after, cursor } = pick(box('one two three'), at(4, 7), { style: 'title', color: 'black' })
    expect(after).toMatchObject({ sizes: 't4-7', colors: 'k4-7' })
    expect(cursor).toEqual(at(4, 7))
  })

  it('changes the whole box when it is not being typed in, leaving the other attribute alone', () => {
    const mixed = box('one two', { sizes: 'h0-3', colors: 'g4-7' })
    expect(pick(mixed, null, { style: 'small' }).box).toMatchObject({ style: 'small', sizes: undefined, colors: 'g4-7' })
    expect(pick(mixed, null, { color: 'black' }).box).toMatchObject({ color: 'black', colors: undefined, sizes: 'h0-3' })
  })

  it('becomes the base again once all the text matches', () => {
    const half = pick(box('ab'), at(0, 1), { style: 'title' }).box
    expect(pick(half, at(1, 2), { style: 'title' }).box).toMatchObject({ style: 'title', sizes: undefined })
  })

  it('with nothing selected, leaves the text as it is and waits for typing', () => {
    const before = box('Fear')
    const first = pick(before, at(4), { style: 'heading' })
    const second = pick(first.box, first.cursor, { color: 'grey' })
    expect(second.box).toMatchObject({ sizes: undefined, colors: undefined })
    expect(second.cursor).toEqual({ start: 4, end: 4, pending: { style: 'heading', color: 'grey' } })
  })

  it('restyles an empty box straight away', () => {
    expect(pick(box(''), at(0), { style: 'title' }).box.style).toBe('title')
  })
})

describe('typing', () => {
  it('uses what was picked, and carries on in it', () => {
    let state = pick(box('Fear '), at(5), { style: 'heading', color: 'grey' })
    let typed = type(state.box, state.cursor!, 'n')
    typed = type(typed.box, typed.cursor, 'ow')
    expect(typed.box).toMatchObject({ text: 'Fear now', sizes: 'h5-8', colors: 'g5-8' })
    state = pick(typed.box, typed.cursor, { style: 'body' })
    expect(type(state.box, state.cursor!, '!').box).toMatchObject({ text: 'Fear now!', sizes: 'h5-8', colors: 'g5-9' })
  })

  it('uses what was picked in the middle of a word', () => {
    const state = pick(box('abcd'), at(2), { color: 'black' })
    expect(type(state.box, state.cursor!, 'X').box).toMatchObject({ text: 'abXcd', colors: 'k2-3' })
  })

  it('otherwise matches the character before it', () => {
    const before = box('bigsmall', { sizes: 't0-3' })
    expect(type(before, at(3), '!').box.sizes).toBe('t0-4')
  })

  it('at the start of a line, matches the character after it', () => {
    const before = box('ab\ncd', { sizes: 't3-5' })
    expect(type(before, at(3), 'x').box.sizes).toBe('t3-6')
  })

  it('on a new last line, matches the line above', () => {
    const before = box('ab\ncd\n', { sizes: 't3-6' })
    expect(type(before, at(6), 'e').box.sizes).toBe('t3-7')
  })

  it('over a selection, looks like what it replaces', () => {
    const before = box('one two', { colors: 'g4-7' })
    expect(type(before, at(4, 7), '2').box).toMatchObject({ text: 'one 2', colors: 'g4-5' })
  })

  it('places a repeated letter by the caret', () => {
    const before = box('aa', { colors: 'g1-2' })
    expect(type(before, at(1), 'a').box.colors).toBe('g2-3')
    expect(type(before, at(2), 'a').box.colors).toBe('g1-3')
  })

  it('keeps the pick when the browser swaps its placeholder line break for the typed letter', () => {
    const before = box('ab\n\n')
    const cursor: TextCursor = { start: 3, end: 3, pending: { style: 'small' } }
    expect(editFormats(before, 'ab\nc', { caret: 4, cursor }).sizes).toBe('s3-4')
  })

  it('moves the formats along when text is deleted before them', () => {
    const before = box('one two', { sizes: 'h4-7' })
    expect(editFormats(before, 'two', { caret: 0 }).style).toBe('heading')
    expect(editFormats(before, 'ne two', { caret: 0 }).sizes).toBe('h3-6')
  })

  it('remembers the format of deleted text once the box is empty', () => {
    const before = box('Hi', { sizes: 't0-1' })
    expect(editFormats(before, '', { caret: 0 })).toMatchObject({ style: 'title', sizes: undefined })
  })
})

describe('what the toolbar shows', () => {
  const mixed = box('big\nsmall', { sizes: 't0-4', colors: 'g4-9' })

  it('shows what the selected text shares, and nothing for what it mixes', () => {
    expect(shownFormat(mixed, at(0, 3))).toEqual({ style: 'title', color: 'white' })
    expect(shownFormat(mixed, at(0, 9))).toEqual({ style: undefined, color: undefined })
    expect(shownFormat(mixed, null)).toEqual({ style: undefined, color: undefined })
  })

  it('shows what would be typed at the caret', () => {
    expect(shownFormat(mixed, at(2))).toEqual({ style: 'title', color: 'white' })
    expect(shownFormat(mixed, at(4))).toEqual({ style: 'body', color: 'grey' })
    expect(shownFormat(mixed, { ...at(4), pending: { style: 'small' } })).toEqual({ style: 'small', color: 'grey' })
  })
})

describe('showing lines', () => {
  it('lays a line out in its smallest size, and a bullet in the size of its first letter', () => {
    const lines = formattedLines(box('Big small\n• Dot\n', { sizes: 't0-4,s4-9,h10-15' }))
    expect(lines.map((line) => [line.bullet, line.style])).toEqual([
      [false, 'small'],
      [true, 'heading'],
      [false, 'body'],
    ])
    expect(lines[1].segments).toEqual([{ text: 'Dot', style: 'heading', color: 'white' }])
  })
})
