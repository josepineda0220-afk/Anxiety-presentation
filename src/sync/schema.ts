/**
 * How the deck is stored in Firestore, as plain data. firestore.rules enforces every limit here, so
 * keep the two in step.
 *
 *   presentations/{deckId}                 the index: section order, box ids, snapshot bookkeeping
 *   presentations/{deckId}/sections/{id}   one section and its slides
 *   presentations/{deckId}/boxes/{id}      one text box
 *   presentations/{deckId}/versions/{seq}  append-only snapshots of the whole deck
 *
 * Each section and each box is its own document with its own revision, so edits to different parts
 * never collide. Removing a part writes it again with `deleted: true`, since nothing may be deleted.
 *
 * This module has no Firebase imports, so tests and the main bundle can use it freely.
 */
import {
  BACKDROP_THEMES,
  DEFAULT_CURSOR_EFFECT,
  DEFAULT_PARTICLE_STYLE,
  type BackdropTheme,
  type Section,
  type SlideSpec,
} from '../data/sections'
import type { TextBox } from '../deck/deckStore'

/** 1 was the encrypted single-document envelope. */
export const SCHEMA_VERSION = 2

export const LIMITS = {
  textLength: 5000,
  /** Characters in each of a box's lists of text sizes and colours. */
  formatListLength: 4000,
  titleLength: 200,
  slidesPerSection: 30,
  sections: 60,
  boxes: 2000,
  /** Width and length of a box, in stage units. */
  boxSize: 200,
  snapshotJsonLength: 900_000,
} as const

/** How often the app saves a version while people edit. The rules allow one every 4 minutes or more. */
export const SNAPSHOT_INTERVAL_MS = 5 * 60_000

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const REGION_IDS = ['amygdala', 'hippocampus', 'caudate', 'putamen', 'pallidum', 'thalamus', 'dlpfc', 'ofc', 'acc', 'insula'] as const

export type PartKind = 'section' | 'box'

/** A section as stored: everything except its id, which is the document id. */
export type SectionData = Omit<Section, 'id'>
/** A text box as stored: everything except its id, which is the document id. */
export type BoxData = Omit<TextBox, 'id'>
export type PartData = SectionData | BoxData

/** The fields every document carries. `updatedAt` is a server timestamp. */
export interface Stamp {
  schemaVersion: number
  revision: number
  updatedBy: string
}

/** What the app knows about one part on the server. Revision 0 means it has never been saved. */
export interface RemotePart<T extends PartData = PartData> {
  revision: number
  /** Null when the part was removed (or never existed). */
  data: T | null
}

export interface DeckIndex {
  revision: number
  sectionOrder: string[]
  boxIds: string[]
  snapshotSeq: number
  /** When the last version was saved, in milliseconds, by the server's clock. */
  lastSnapshotAt: number
}

/** The whole deck at one moment, as a version stores it. */
export interface DeckSnapshot {
  sectionOrder: string[]
  sections: Record<string, SectionData>
  boxes: Record<string, BoxData>
}

export const partKey = (kind: PartKind, id: string) => `${kind}:${id}`

export function parsePartKey(key: string): { kind: PartKind; id: string } {
  const at = key.indexOf(':')
  return { kind: key.slice(0, at) as PartKind, id: key.slice(at + 1) }
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * A slide's focus as it is saved: the regions and circuits it lights. A hand-set camera pose is
 * only ever written in code (no slide or screen sets one), so it is not saved.
 */
function cleanFocus(focus: SlideSpec['focus']): SlideSpec['focus'] {
  return { regions: [...focus.regions], circuits: [...focus.circuits] }
}

const CURSOR_EFFECTS: readonly string[] = ['part', 'ripple', 'off']
const PARTICLE_STYLES: readonly string[] = ['plain', 'sparkle']

/**
 * A slide as saved. The brain's side is kept only when it is not the default, like the section
 * options, and the slide's own look only where it picked one.
 */
function cleanSlide(slide: SlideSpec): SlideSpec {
  const clean: SlideSpec = { id: slide.id, title: slide.title, focus: cleanFocus(slide.focus) }
  if (slide.side === 'left') clean.side = 'left'
  if ((BACKDROP_THEMES as readonly unknown[]).includes(slide.backdrop)) clean.backdrop = slide.backdrop
  if (CURSOR_EFFECTS.includes(slide.cursorEffect as string)) clean.cursorEffect = slide.cursorEffect
  if (PARTICLE_STYLES.includes(slide.particles as string)) clean.particles = slide.particles
  return clean
}

/** A section's content. Fields that are left out stay left out, because Firestore cannot store undefined. */
export function sectionToData(section: Section): SectionData {
  const data: SectionData = {
    title: section.title,
    backdrop: section.backdrop,
    slides: section.slides.map(cleanSlide),
  }
  if (section.cursorEffect && section.cursorEffect !== DEFAULT_CURSOR_EFFECT) data.cursorEffect = section.cursorEffect
  if (section.particles && section.particles !== DEFAULT_PARTICLE_STYLE) data.particles = section.particles
  return data
}

/**
 * How a section's slides are stored: one list per field, one entry per slide, in order. Rules cannot
 * loop over a list of maps, but they can check a whole list of strings at once, so this lets them
 * check every slide of any length section within their per-request budget.
 */
interface StoredSlides {
  slideIds: string[]
  slideTitles: string[]
  /** The regions each slide lights, comma separated. */
  slideRegions: string[]
  /** 'cstc' or ''. */
  slideCircuits: string[]
  /** 'left' or '', for the brain's side. Left out when every slide has the brain on the right. */
  slideSides?: string[]
  /** Each slide's own backdrop, or '' to use the section's. Left out when no slide has its own. */
  slideBackdrops?: string[]
  /** Each slide's own cursor effect, or ''. */
  slideCursors?: string[]
  /** Each slide's own dot style, or ''. */
  slideParticles?: string[]
}

/** The slide fields that are stored as an optional list of their own, with '' for "not set". */
const OPTIONAL_SLIDE_LISTS = [
  ['side', 'slideSides'],
  ['backdrop', 'slideBackdrops'],
  ['cursorEffect', 'slideCursors'],
  ['particles', 'slideParticles'],
] as const

function slidesToStored(slides: SlideSpec[]): StoredSlides {
  const stored: StoredSlides = {
    slideIds: slides.map((slide) => slide.id),
    slideTitles: slides.map((slide) => slide.title),
    slideRegions: slides.map((slide) => slide.focus.regions.join(',')),
    slideCircuits: slides.map((slide) => slide.focus.circuits.join(',')),
  }
  for (const [field, list] of OPTIONAL_SLIDE_LISTS) {
    if (slides.some((slide) => slide[field])) stored[list] = slides.map((slide) => slide[field] ?? '')
  }
  return stored
}

function slidesFromStored(raw: Record<string, unknown>): SlideSpec[] | null {
  const { slideIds, slideTitles, slideRegions, slideCircuits } = raw
  if (![slideIds, slideTitles, slideRegions, slideCircuits].every(Array.isArray)) return null
  const optional = (list: string) => (Array.isArray(raw[list]) ? (raw[list] as unknown[]) : [])
  const [sides, backdrops, cursors, particles] = OPTIONAL_SLIDE_LISTS.map(([, list]) => optional(list))
  const ids = slideIds as unknown[]
  return ids.map((id, i) => {
    const slide: SlideSpec = {
      id: String(id),
      title: String((slideTitles as unknown[])[i] ?? ''),
      focus: {
        regions: String((slideRegions as unknown[])[i] ?? '')
          .split(',')
          .filter((region): region is SlideSpec['focus']['regions'][number] => (REGION_IDS as readonly string[]).includes(region)),
        circuits: String((slideCircuits as unknown[])[i] ?? '') === 'cstc' ? ['cstc'] : [],
      },
    }
    if (sides[i] === 'left') slide.side = 'left'
    if ((BACKDROP_THEMES as readonly unknown[]).includes(backdrops[i])) slide.backdrop = backdrops[i] as BackdropTheme
    if (CURSOR_EFFECTS.includes(cursors[i] as string)) slide.cursorEffect = cursors[i] as SlideSpec['cursorEffect']
    if (PARTICLE_STYLES.includes(particles[i] as string)) slide.particles = particles[i] as SlideSpec['particles']
    return slide
  })
}

/**
 * A box as stored. Positions are kept on screen and sizes within what the rules accept; a length
 * under one unit means "fit the text", which is the same as leaving it out.
 */
export function boxToData(box: TextBox): BoxData {
  const data: BoxData = {
    slide: box.slide,
    text: box.text,
    x: clamp(box.x, 0, 1),
    y: clamp(box.y, 0, 1),
    style: box.style,
    color: box.color,
    look: box.look,
  }
  if (box.sizes) data.sizes = box.sizes
  if (box.colors) data.colors = box.colors
  if (box.width !== undefined && box.width >= 1) data.width = Math.min(box.width, LIMITS.boxSize)
  if (box.height !== undefined && box.height >= 1) data.height = Math.min(box.height, LIMITS.boxSize)
  return data
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Reads a section from its app shape (`slides`) or its stored shape (`slideIds` and friends). */
function readSection(raw: Record<string, unknown>): SectionData | null {
  if (typeof raw.title !== 'string') return null
  if (!(BACKDROP_THEMES as readonly unknown[]).includes(raw.backdrop)) return null
  const slides = Array.isArray(raw.slides)
    ? (raw.slides as SlideSpec[]).map(cleanSlide)
    : slidesFromStored(raw)
  if (!slides) return null
  const section: SectionData = { title: raw.title, backdrop: raw.backdrop as BackdropTheme, slides }
  if (raw.cursorEffect === 'ripple' || raw.cursorEffect === 'off') section.cursorEffect = raw.cursorEffect
  if (raw.particles === 'sparkle') section.particles = raw.particles
  return section
}

/** Reads the content of a stored section document, or null if it is removed or not a section. */
export function sectionFromDoc(raw: unknown): SectionData | null {
  if (!isRecord(raw) || raw.deleted === true) return null
  return readSection(raw)
}

/** Reads the content fields of a stored box, or null if it is removed or not a box. */
export function boxFromDoc(raw: unknown): BoxData | null {
  if (!isRecord(raw) || raw.deleted === true) return null
  if (typeof raw.slide !== 'string' || typeof raw.text !== 'string') return null
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null
  const box: BoxData = {
    slide: raw.slide,
    text: raw.text,
    x: raw.x,
    y: raw.y,
    style: raw.style as BoxData['style'],
    color: raw.color as BoxData['color'],
    look: raw.look as BoxData['look'],
  }
  if (typeof raw.sizes === 'string' && raw.sizes) box.sizes = raw.sizes
  if (typeof raw.colors === 'string' && raw.colors) box.colors = raw.colors
  if (typeof raw.width === 'number') box.width = raw.width
  if (typeof raw.height === 'number') box.height = raw.height
  return box
}

export function partFromDoc(kind: PartKind, raw: unknown): PartData | null {
  return kind === 'section' ? sectionFromDoc(raw) : boxFromDoc(raw)
}

/**
 * The document to save for a part. A removed part is saved with its last content and
 * `deleted: true`, so restoring it later needs nothing but its history.
 */
export function partDocument(
  kind: PartKind,
  data: PartData | null,
  previous: PartData | null,
  revision: number,
  uid: string,
): Record<string, unknown> {
  const content = data ?? previous ?? emptyPart(kind)
  return { ...storedContent(kind, content), deleted: data === null, schemaVersion: SCHEMA_VERSION, revision, updatedBy: uid }
}

/** A part's content fields as they are stored. */
export function storedContent(kind: PartKind, content: PartData): Record<string, unknown> {
  if (kind === 'box') return { ...content }
  const { slides, ...section } = content as SectionData
  return { ...section, ...slidesToStored(slides) }
}

/** What a tombstone holds for a part that is removed before it was ever saved with content. */
function emptyPart(kind: PartKind): PartData {
  return kind === 'section'
    ? { title: 'Removed section', backdrop: 'blue', slides: [{ id: 'removed', title: '', focus: { regions: [], circuits: [] } }] }
    : { slide: 'removed', text: '', x: 0, y: 0, style: 'body', color: 'white', look: 'clear' }
}

/** Why a part cannot be saved, in words for the person editing, or null if it is fine. */
export function partProblem(kind: PartKind, data: PartData | null): string | null {
  if (data === null) return null
  if (kind === 'box') {
    const box = data as BoxData
    if (box.text.length > LIMITS.textLength) return `A text box can hold up to ${LIMITS.textLength.toLocaleString()} characters.`
    if (Math.max(box.sizes?.length ?? 0, box.colors?.length ?? 0) > LIMITS.formatListLength) {
      return 'This text box changes size or colour too many times. Make more of it match.'
    }
    if (!ID_PATTERN.test(box.slide)) return 'This text box is on a slide the deck does not know.'
    return null
  }
  const section = data as SectionData
  if (!section.title.trim()) return 'A section needs a title.'
  if (section.title.length > LIMITS.titleLength) return `Section titles can be up to ${LIMITS.titleLength} characters.`
  if (section.slides.length === 0) return 'A section needs at least one slide.'
  if (section.slides.length > LIMITS.slidesPerSection) return `A section can have up to ${LIMITS.slidesPerSection} slides.`
  if (section.slides.some((slide) => slide.title.length > LIMITS.titleLength || !ID_PATTERN.test(slide.id))) {
    return `Slide titles can be up to ${LIMITS.titleLength} characters.`
  }
  return null
}

/** True when two stored values are the same, whatever the order of their keys. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameData(item, b[i]))
  if (!isRecord(a) || !isRecord(b) || Array.isArray(b)) return false
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined)
  return keys.length === otherKeys.length && keys.every((key) => sameData(a[key], b[key]))
}

/**
 * The ids in `ids`, put in the order `wanted` gives them. Ids `wanted` leaves out (say, a section
 * someone else just added) keep their order after the rest.
 */
export function arrangeLike(ids: string[], wanted: string[]): string[] {
  const present = new Set(ids)
  const first = wanted.filter((id, i) => present.has(id) && wanted.indexOf(id) === i)
  const placed = new Set(first)
  return [...first, ...ids.filter((id) => !placed.has(id))]
}

export function encodeSnapshot(snapshot: DeckSnapshot): string {
  return JSON.stringify(snapshot)
}

export function decodeSnapshot(json: string): DeckSnapshot | null {
  try {
    const raw = JSON.parse(json) as unknown
    if (!isRecord(raw) || !Array.isArray(raw.sectionOrder) || !isRecord(raw.sections) || !isRecord(raw.boxes)) return null
    const sections: Record<string, SectionData> = {}
    for (const [id, value] of Object.entries(raw.sections)) {
      const section = sectionFromDoc(value)
      if (section && ID_PATTERN.test(id)) sections[id] = section
    }
    const boxes: Record<string, BoxData> = {}
    for (const [id, value] of Object.entries(raw.boxes)) {
      const box = boxFromDoc(value)
      if (box && ID_PATTERN.test(id)) boxes[id] = box
    }
    const sectionOrder = (raw.sectionOrder as unknown[]).filter((id): id is string => typeof id === 'string' && id in sections)
    return { sectionOrder, sections, boxes }
  } catch {
    return null
  }
}

/** The deck in the app's own shape, in section order. */
export function snapshotToDeck(snapshot: DeckSnapshot): { sections: Section[]; boxes: TextBox[] } {
  return {
    sections: snapshot.sectionOrder.map((id) => ({ id, ...snapshot.sections[id] })),
    boxes: Object.entries(snapshot.boxes).map(([id, box]) => ({ id, ...box })),
  }
}

export function deckToSnapshot(sections: Section[], boxes: TextBox[]): DeckSnapshot {
  const snapshot: DeckSnapshot = { sectionOrder: [], sections: {}, boxes: {} }
  for (const section of sections) {
    snapshot.sectionOrder.push(section.id)
    snapshot.sections[section.id] = sectionToData(section)
  }
  for (const box of boxes) {
    if (box.text.trim()) snapshot.boxes[box.id] = boxToData(box)
  }
  return snapshot
}
