/**
 * Three-way merging for one section or text box, given the version both sides started from (base),
 * this device's version (mine) and the version now on the server (theirs).
 *
 * A field only one side changed takes that side's value, so most concurrent edits combine without
 * asking anyone. A field both sides changed in different ways is a conflict, which the person
 * editing settles (see ConflictPrompt).
 */
import type { SlideSpec } from '../data/sections'
import { charFormats, editFormats, withFormats, type FormattedText } from '../deck/format'
import { sameData, type PartData } from './schema'

export interface MergeResult {
  /** The combined part. For each conflicting field it holds this device's value. Null means removed. */
  merged: PartData | null
  /** Fields both sides changed in different ways. 'deleted' means one side removed the part. */
  conflicts: string[]
}

type Fields = Record<string, unknown>

/** A box's base size and colour, each with the list of text that differs from it. */
const SIZE_FIELDS = ['style', 'sizes']
const COLOR_FIELDS = ['color', 'colors']

const isMixed = (...versions: Fields[]) => versions.some((version) => version.sizes !== undefined || version.colors !== undefined)
const same = (keys: string[], a: Fields, b: Fields) => keys.every((key) => sameData(a[key], b[key]))

/**
 * Fields of a box that can only be taken from one side together. Mixed sizes and colours are stored
 * as positions in the text, so once the words change, they go with the words.
 */
function tiedFields(b: Fields, m: Fields, t: Fields): string[][] {
  if (!isMixed(b, m, t)) return []
  const retyped = !sameData(m.text, b.text) || !sameData(t.text, b.text)
  return retyped ? [['text', ...SIZE_FIELDS, ...COLOR_FIELDS]] : [SIZE_FIELDS, COLOR_FIELDS]
}

/** Merges slide lists by slide id: additions from both sides are kept, and a removal wins over no change. */
function mergeSlides(base: SlideSpec[], mine: SlideSpec[], theirs: SlideSpec[]): { slides: SlideSpec[]; conflict: boolean } {
  const byId = (slides: SlideSpec[]) => new Map(slides.map((slide) => [slide.id, slide]))
  const baseById = byId(base)
  const mineById = byId(mine)
  const theirsById = byId(theirs)
  let conflict = false

  const pick = (id: string): SlideSpec | null => {
    const b = baseById.get(id) ?? null
    const m = mineById.get(id) ?? null
    const t = theirsById.get(id) ?? null
    if (sameData(m, t)) return m
    if (sameData(m, b)) return t
    if (sameData(t, b)) return m
    conflict = true
    // Keep the slide when one side removed it and the other changed it, so nothing is lost.
    return m ?? t
  }

  // Their order first, then slides only this device added, where it added them (at the end).
  const order = [...theirs.map((slide) => slide.id), ...mine.map((slide) => slide.id).filter((id) => !theirsById.has(id))]
  const slides = order.map(pick).filter((slide): slide is SlideSpec => slide !== null)
  return { slides: slides.length > 0 ? slides : mine, conflict }
}

export function threeWayMerge(base: PartData | null, mine: PartData | null, theirs: PartData | null): MergeResult {
  if (sameData(mine, theirs)) return { merged: mine, conflicts: [] }
  if (sameData(mine, base)) return { merged: theirs, conflicts: [] }
  if (sameData(theirs, base)) return { merged: mine, conflicts: [] }
  // One side removed the part and the other changed it.
  if (mine === null || theirs === null) return { merged: mine, conflicts: ['deleted'] }

  const b = (base ?? {}) as Fields
  const m = mine as unknown as Fields
  const t = theirs as unknown as Fields
  const merged: Fields = {}
  const conflicts: string[] = []

  const keys = new Set([...Object.keys(m), ...Object.keys(t)])
  for (const tied of tiedFields(b, m, t)) {
    let from = m
    if (!same(tied, m, t)) {
      if (same(tied, m, b)) from = t
      else if (!same(tied, t, b)) conflicts.push(tied[0])
    }
    for (const key of tied) {
      merged[key] = from[key]
      keys.delete(key)
    }
  }

  for (const key of keys) {
    if (key === 'slides' && Array.isArray(m.slides) && Array.isArray(t.slides)) {
      const result = mergeSlides((b.slides as SlideSpec[] | undefined) ?? [], m.slides as SlideSpec[], t.slides as SlideSpec[])
      merged.slides = result.slides
      if (result.conflict) conflicts.push('slides')
      continue
    }
    if (sameData(m[key], t[key])) merged[key] = m[key]
    else if (sameData(m[key], b[key])) merged[key] = t[key]
    else if (sameData(t[key], b[key])) merged[key] = m[key]
    else {
      merged[key] = m[key]
      conflicts.push(key)
    }
  }
  return { merged: tidy(merged), conflicts }
}

/**
 * Two versions of a text, both kept. Their text comes first, then this device's, unless one
 * already contains the other.
 */
export function combineText(theirs: string, mine: string): string {
  if (theirs.includes(mine)) return theirs
  if (mine.includes(theirs)) return mine
  return `${theirs.replace(/\s+$/, '')}\n\n${mine.replace(/^\s+/, '')}`
}

/** Two versions of a box's words, both kept, each looking as it did. */
function combineFormatted(theirs: FormattedText, mine: FormattedText) {
  const text = combineText(theirs.text, mine.text)
  const whole = [mine, theirs].find((version) => version.text === text)
  if (whole) return { text, ...withFormats(text, whole, charFormats(whole)) }
  const first = theirs.text.replace(/\s+$/, '')
  const second = mine.text.replace(/^\s+/, '')
  const firstChars = charFormats(theirs).slice(0, first.length)
  const between = firstChars[firstChars.length - 1] ?? theirs
  const chars = [...firstChars, between, between, ...charFormats(mine).slice(mine.text.length - second.length)]
  return { text, ...withFormats(text, theirs, chars) }
}

/** Drops fields that ended up empty, since they cannot be saved. */
function tidy(part: object): PartData {
  return Object.fromEntries(Object.entries(part).filter(([, value]) => value !== undefined)) as unknown as PartData
}

/**
 * The "merge" choice in a conflict: everything that merges cleanly, both texts where both changed
 * the text, this device's value for any other field both changed, and the part kept rather than
 * removed if only one side removed it.
 */
export function mergeKeepingBoth(base: PartData | null, mine: PartData | null, theirs: PartData | null): PartData | null {
  if (mine === null || theirs === null) return mine ?? theirs
  const { merged } = threeWayMerge(base, mine, theirs)
  if (merged === null) return merged
  const m = mine as unknown as Fields
  const t = theirs as unknown as Fields
  const b = (base ?? {}) as Fields
  if (typeof m.text !== 'string' || typeof t.text !== 'string') return merged
  const mineTyped = m.text !== b.text
  const theirsTyped = t.text !== b.text
  const formattedMine = mine as unknown as FormattedText
  const formattedTheirs = theirs as unknown as FormattedText
  if (mineTyped && theirsTyped) return tidy({ ...merged, ...combineFormatted(formattedTheirs, formattedMine) })
  // One side typed and the other restyled: the new words, in the sizes or colours picked for the old.
  if (isMixed(b, m, t) && mineTyped !== theirsTyped) {
    const [typed, restyled] = mineTyped ? [formattedMine, formattedTheirs] : [formattedTheirs, formattedMine]
    const carried = editFormats(restyled, typed.text) as unknown as Fields
    const result: Fields = { ...merged, ...(typed as unknown as Fields) }
    for (const tied of [SIZE_FIELDS, COLOR_FIELDS]) {
      if (!same(tied, restyled as unknown as Fields, b)) for (const key of tied) result[key] = carried[key]
    }
    return tidy(result)
  }
  return merged
}
