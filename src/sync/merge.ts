/**
 * Three-way merging for one section or text box, given the version both sides started from (base),
 * this device's version (mine) and the version now on the server (theirs).
 *
 * A field only one side changed takes that side's value, so most concurrent edits combine without
 * asking anyone. A field both sides changed in different ways is a conflict, which the person
 * editing settles (see ConflictPrompt).
 */
import type { SlideSpec } from '../data/sections'
import { sameData, type PartData } from './schema'

export interface MergeResult {
  /** The combined part. For each conflicting field it holds this device's value. Null means removed. */
  merged: PartData | null
  /** Fields both sides changed in different ways. 'deleted' means one side removed the part. */
  conflicts: string[]
}

type Fields = Record<string, unknown>

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

  for (const key of new Set([...Object.keys(m), ...Object.keys(t)])) {
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
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]
  return { merged: merged as unknown as PartData, conflicts }
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
  if (typeof m.text === 'string' && typeof t.text === 'string' && !sameData(m.text, b.text) && !sameData(t.text, b.text)) {
    return { ...merged, text: combineText(t.text, m.text) } as PartData
  }
  return merged
}
