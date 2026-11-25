/**
 * Text size and colour within a box. A box has one base size (`style`) and colour (`color`).
 * `sizes` and `colors` list the stretches of its text that differ, as "h0-8,s20-31": a letter for
 * the size or colour, then start and end character offsets. This module has no React or DOM code.
 */
import type { TextColor, TextStyle } from './deckStore'

/** What one character looks like. */
export interface CharFormat {
  style: TextStyle
  color: TextColor
}

export interface FormattedText extends CharFormat {
  text: string
  /** Left out when all the text is one size. */
  sizes?: string
  /** Left out when all the text is one colour. */
  colors?: string
}

/** A box's format fields. All are always present, so spreading them over a box replaces its format. */
export interface Formats extends CharFormat {
  sizes: string | undefined
  colors: string | undefined
}

/** Where the caret or selection is in the text being typed in. */
export interface TextRange {
  start: number
  end: number
}

export interface TextCursor extends TextRange {
  /** Picked with nothing selected: the next characters typed here take it. */
  pending?: Partial<CharFormat>
}

export interface Segment extends CharFormat {
  text: string
}

export interface FormattedLine {
  bullet: boolean
  /** How the line itself is laid out; its segments may be larger, or another colour. */
  style: TextStyle
  color: TextColor
  segments: Segment[]
}

/** Smallest first. */
const BY_SIZE: TextStyle[] = ['small', 'body', 'heading', 'title']
const SIZE_LETTERS: Record<TextStyle, string> = { title: 't', heading: 'h', body: 'b', small: 's' }
const COLOR_LETTERS: Record<TextColor, string> = { white: 'w', grey: 'g', black: 'k' }

export const BULLET = /^•\s*/

function decode<T extends string>(length: number, base: T, list: string | undefined, letters: Record<T, string>): T[] {
  const values = new Array<T>(length).fill(base)
  for (const run of list?.split(',') ?? []) {
    const match = /^([a-z])(\d+)-(\d+)$/.exec(run)
    const value = (Object.keys(letters) as T[]).find((key) => letters[key] === match?.[1])
    if (!match || !value) continue
    const end = Math.min(Number(match[3]), length)
    for (let i = Number(match[2]); i < end; i++) values[i] = value
  }
  return values
}

/** The base value and list for these characters. One value throughout needs no list. */
function encode<T extends string>(text: string, base: T, values: T[], letters: Record<T, string>): [T, string | undefined] {
  if (text.length === 0) return [base, undefined]
  const each = values.slice(0, text.length)
  // The two halves of an emoji are one character on screen, so they match.
  for (let i = 1; i < each.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xdc00 && code <= 0xdfff) each[i] = each[i - 1]
  }
  if (each.every((value) => value === each[0])) return [each[0], undefined]
  const runs: string[] = []
  for (let start = 0, i = 1; i <= each.length; i++) {
    if (i < each.length && each[i] === each[start]) continue
    if (each[start] !== base) runs.push(`${letters[each[start]]}${start}-${i}`)
    start = i
  }
  return [base, runs.join(',')]
}

/** The format of each character. */
export function charFormats(box: FormattedText): CharFormat[] {
  const sizes = decode(box.text.length, box.style, box.sizes, SIZE_LETTERS)
  const colors = decode(box.text.length, box.color, box.colors, COLOR_LETTERS)
  return sizes.map((style, i) => ({ style, color: colors[i] }))
}

/** The format fields for text whose characters look like this. */
export function withFormats(text: string, base: CharFormat, chars: CharFormat[]): Formats {
  const [style, sizes] = encode(text, base.style, chars.map((c) => c.style), SIZE_LETTERS)
  const [color, colors] = encode(text, base.color, chars.map((c) => c.color), COLOR_LETTERS)
  return { style, sizes, color, colors }
}

/**
 * The format text typed at an offset gets: that of the character before it, or at the start of a
 * line, of the character after it.
 */
function typingFormat(box: FormattedText, chars: CharFormat[], at: number): CharFormat {
  const lineStart = at === 0 || box.text[at - 1] === '\n'
  const near = lineStart ? (chars[at] ?? chars[at - 1]) : chars[at - 1]
  return near ?? { style: box.style, color: box.color }
}

/** How many characters at the start and at the end an edit left alone. */
function unchangedEnds(before: string, after: string, caret: number | undefined): [number, number] {
  // The caret ends up after whatever was typed, which settles where a repeated letter went in.
  if (caret !== undefined && caret <= after.length && before.endsWith(after.slice(caret))) {
    const suffix = after.length - caret
    const most = Math.min(before.length - suffix, caret)
    let prefix = 0
    while (prefix < most && before[prefix] === after[prefix]) prefix++
    return [prefix, suffix]
  }
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return [prefix, suffix]
}

/**
 * The formats after the text changes to `text`. Typed text takes what was picked for it. Otherwise
 * text typed over a selection looks like what it replaces, and other text like its neighbour (see
 * typingFormat).
 */
export function editFormats(before: FormattedText, text: string, { caret, cursor }: { caret?: number; cursor?: TextCursor } = {}): Formats {
  if (!before.sizes && !before.colors && !cursor?.pending) {
    return { style: before.style, color: before.color, sizes: undefined, colors: undefined }
  }
  const chars = charFormats(before)
  const [prefix, suffix] = unchangedEnds(before.text, text, caret)
  const removed = before.text.length - prefix - suffix

  const waiting = cursor?.start === prefix ? cursor.pending : undefined
  const format =
    !waiting && removed > 0 ? chars[prefix] : { ...typingFormat(before, chars, prefix), ...waiting }

  const added = new Array<CharFormat>(text.length - prefix - suffix).fill(format)
  // An emptied box keeps the format of what was just deleted, for whatever is typed next.
  const base = text.length === 0 ? format : before
  return withFormats(text, base, [...chars.slice(0, prefix), ...added, ...chars.slice(before.text.length - suffix)])
}

/**
 * Picking a size or colour. With no cursor (the box is selected but not being typed in) the whole
 * box takes it. While typing, the selected text takes it. With nothing selected the text stays as it
 * is, and the pick waits for what is typed next.
 */
export function pickFormat(box: FormattedText, cursor: TextCursor | null, pick: Partial<CharFormat>): { formats: Formats; cursor: TextCursor | null } {
  const current: Formats = { style: box.style, color: box.color, sizes: box.sizes, colors: box.colors }
  if (!cursor || box.text.length === 0) {
    const formats = {
      ...current,
      ...pick,
      ...(pick.style && { sizes: undefined }),
      ...(pick.color && { colors: undefined }),
    }
    return { formats, cursor: cursor && { start: cursor.start, end: cursor.end } }
  }
  const { start, end, pending } = cursor
  if (start === end) return { formats: current, cursor: { start, end, pending: { ...pending, ...pick } } }
  const chars = charFormats(box).map((format, i) => (i >= start && i < end ? { ...format, ...pick } : format))
  return { formats: withFormats(box.text, box, chars), cursor: { start, end } }
}

/**
 * What the toolbar should show as on: the format of the selected text, or of what would be typed
 * next. An attribute the selected text mixes is undefined.
 */
export function shownFormat(box: FormattedText, cursor: TextCursor | null): Partial<CharFormat> {
  const chars = charFormats(box)
  if (cursor && cursor.start === cursor.end) return { ...typingFormat(box, chars, cursor.start), ...cursor.pending }
  const { start, end } = cursor ?? { start: 0, end: box.text.length }
  if (start >= end) return { style: box.style, color: box.color }
  // Line breaks only count when there is nothing else.
  const visible = chars.slice(start, end).filter((_, i) => box.text[start + i] !== '\n')
  const counted = visible.length > 0 ? visible : chars.slice(start, end)
  const shared = <K extends keyof CharFormat>(key: K) =>
    counted.every((format) => format[key] === counted[0][key]) ? counted[0][key] : undefined
  return { style: shared('style'), color: shared('color') }
}

/** Text split into stretches that look the same. */
export function segmentsOf(text: string, chars: CharFormat[]): Segment[] {
  const segments: Segment[] = []
  for (let start = 0, i = 1; i <= text.length; i++) {
    if (i < text.length && chars[i].style === chars[start].style && chars[i].color === chars[start].color) continue
    segments.push({ ...chars[start], text: text.slice(start, i) })
    start = i
  }
  return segments
}

/** The lines of a box as they are shown. A bullet's dot is left to the stylesheet. */
export function formattedLines(box: FormattedText): FormattedLine[] {
  const chars = charFormats(box)
  let start = 0
  return box.text.split('\n').map((line) => {
    const own = chars.slice(start, start + line.length)
    const first = own[0] ?? chars[start] ?? chars[start - 1] ?? box
    start += line.length + 1
    const dot = BULLET.exec(line)?.[0].length ?? 0
    // A bullet's dot matches the first letter. Other lines are set small enough for any of theirs.
    const style = dot ? first.style : (BY_SIZE.find((size) => own.some((c) => c.style === size)) ?? first.style)
    return { bullet: dot > 0, style, color: first.color, segments: segmentsOf(line.slice(dot), own.slice(dot)) }
  })
}
