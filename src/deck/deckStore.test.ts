import { beforeEach, describe, expect, it } from 'vitest'

// The store saves to localStorage, which Node does not have.
const saved = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => void saved.set(key, value),
  removeItem: (key) => void saved.delete(key),
  clear: () => saved.clear(),
  key: (index) => [...saved.keys()][index] ?? null,
  get length() {
    return saved.size
  },
}

const { STARTER_TEXT, placeNewBox, useDeck } = await import('./deckStore')
const { MEDICATION_SLIDES, SEED_BOXES } = await import('../data/medications')
const { ALL_SEED_BOXES, NON_MEDICATION_SEED_BOXES, SEED_SECTIONS } = await import('../data/sections')
const { getAllSlides, goToSection, goToSlide, stepSlide } = await import('./slides')
const { useStage } = await import('../stage/focusStore')
const { DEFAULT_EDIT_PASSWORD } = await import('../sync/crypto')

const deck = () => useDeck.getState()
const only = () => {
  expect(deck().boxes).toHaveLength(1)
  return deck().boxes[0]
}

beforeEach(() => {
  useDeck.setState({
    slide: '1-1',
    sections: structuredClone(SEED_SECTIONS),
    inputMode: true,
    unlocked: false,
    promptingPassword: false,
    editToken: null,
    selectedId: null,
    editingId: null,
    boxes: [],
    format: { style: 'body', color: 'white', look: 'clear' },
  })
  useStage.setState({
    focus: { regions: [], circuits: [] },
    backdrop: 'blue',
    shift: 0.17,
  })
})

describe('adding a text box', () => {
  it('puts it on the current slide in the current format, ready to type over', () => {
    deck().setSlide('3')
    deck().applyFormat({ style: 'title', look: 'frosted' })
    deck().addBox()
    const box = only()
    expect(box).toMatchObject({ slide: '3', style: 'title', color: 'white', look: 'frosted', text: STARTER_TEXT.title })
    expect(deck().selectedId).toBe(box.id)
    expect(deck().editingId).toBe(box.id)
  })

  it('steps each new box down so they do not stack', () => {
    deck().addBox()
    deck().updateBox(deck().boxes[0].id, { text: 'First' })
    deck().addBox()
    const [first, second] = deck().boxes
    expect(first).toMatchObject(placeNewBox(0))
    expect(second).toMatchObject(placeNewBox(1))
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('counts only the boxes on this slide when placing', () => {
    deck().addBox()
    deck().setSlide('2')
    deck().addBox()
    expect(deck().boxes[1]).toMatchObject({ slide: '2', ...placeNewBox(0) })
  })
})

describe('finishing an edit', () => {
  it('removes a box that was emptied', () => {
    deck().addBox()
    deck().updateBox(only().id, { text: '  \n ' })
    deck().stopEditing()
    expect(deck().boxes).toHaveLength(0)
    expect(deck().selectedId).toBeNull()
    expect(deck().editingId).toBeNull()
  })

  it('drops trailing blank lines and keeps the box selected', () => {
    deck().addBox()
    const { id } = only()
    deck().updateBox(id, { text: 'Fear vs worry\n\n' })
    deck().stopEditing()
    expect(only().text).toBe('Fear vs worry')
    expect(deck().selectedId).toBe(id)
  })

  it('happens when another box is selected, the slide changes, or input mode ends', () => {
    deck().addBox()
    deck().updateBox(only().id, { text: '' })
    deck().select(null)
    expect(deck().boxes).toHaveLength(0)

    deck().addBox()
    deck().updateBox(only().id, { text: '' })
    deck().setSlide('2')
    expect(deck().boxes).toHaveLength(0)

    deck().addBox()
    deck().setInputMode(false)
    expect(only().text).toBe(STARTER_TEXT.body)
    expect(deck().editingId).toBeNull()
    expect(deck().selectedId).toBeNull()
  })
})

describe('formatting', () => {
  it('restyles the selected box and carries its format to the next one', () => {
    deck().addBox()
    deck().stopEditing()
    deck().applyFormat({ color: 'black' })
    deck().applyFormat({ look: 'frosted' })
    expect(only()).toMatchObject({ style: 'body', color: 'black', look: 'frosted' })
    expect(deck().format).toEqual({ style: 'body', color: 'black', look: 'frosted' })
  })

  it('only sets up the next box when nothing is selected', () => {
    deck().addBox()
    deck().select(null)
    deck().applyFormat({ style: 'heading', color: 'grey' })
    expect(only()).toMatchObject({ style: 'body', color: 'white' })
    expect(deck().format).toEqual({ style: 'heading', color: 'grey', look: 'clear' })
  })
})

describe('switching slides', () => {
  it('keeps every slide’s boxes but clears the selection', () => {
    deck().setSlide('1')
    deck().addBox()
    deck().setSlide('2')
    deck().addBox()
    deck().setSlide('1')
    expect(deck().boxes.map((b) => b.slide)).toEqual(['1', '2'])
    expect(deck().selectedId).toBeNull()
  })
})

describe('saving', () => {
  it('keeps the sections, boxes and format, not the mode or selection', () => {
    deck().addBox()
    deck().addBox()
    deck().updateBox(deck().boxes[1].id, { text: '' })
    const stored = JSON.parse(localStorage.getItem('anxiety-presentation:deck')!).state
    expect(Object.keys(stored).sort()).toEqual(['boxes', 'format', 'sections'])
    // The box still being emptied is left out.
    expect(stored.boxes).toHaveLength(1)
  })
})

describe('presentation sections and backdrop themes', () => {
  it('starts with all 9 outline sections in order', () => {
    expect(SEED_SECTIONS.map((s) => s.title)).toEqual([
      'Outline of Presentation',
      'History',
      'Epidemiology',
      'Signs & Symptoms',
      'DSM-5',
      'Predisposing factors',
      'Comorbidity',
      'Medications',
      'Milieu Management',
    ])
  })

  it('switches the stage backdrop when a section’s color is changed or navigated to', () => {
    deck().setSectionBackdrop('sec-2', 'purple')
    expect(useStage.getState().backdrop).toBe('blue')

    goToSection('sec-2')
    expect(deck().slide).toBe('2-1')
    expect(useStage.getState().backdrop).toBe('purple')

    // Stepping back into Section 1 transitions back to blue.
    stepSlide(-1)
    expect(deck().slide).toBe('1-1')
    expect(useStage.getState().backdrop).toBe('blue')
  })

  it('adds and removes sections along with their template boxes', () => {
    const added = deck().addSection('Case Study')
    expect(deck().sections).toHaveLength(10)
    expect(added.title).toBe('Case Study')
    expect(deck().slide).toBe(added.slides[0].id)
    expect(deck().boxes.filter((b) => b.slide === added.slides[0].id).length).toBeGreaterThan(0)

    deck().removeSection(added.id)
    expect(deck().sections).toHaveLength(9)
    expect(deck().boxes.filter((b) => b.slide === added.slides[0].id)).toHaveLength(0)
    expect(deck().slide).toBe('9-1')
  })

  it('adds and removes slides within a section, keeping at least 1 slide per section', () => {
    goToSection('sec-2')
    const added = deck().addSlide('sec-2')!
    expect(deck().sections.find((s) => s.id === 'sec-2')!.slides).toHaveLength(3)
    expect(deck().slide).toBe(added.id)

    deck().removeSlide(added.id)
    expect(deck().sections.find((s) => s.id === 'sec-2')!.slides).toHaveLength(2)

    // Section 1 only has 1 slide; removeSlide will not leave a section empty.
    goToSection('sec-1')
    deck().removeSlide('1-1')
    expect(deck().sections.find((s) => s.id === 'sec-1')!.slides).toHaveLength(1)
  })

  it('steps seamlessly across section boundaries', () => {
    goToSlide('1-1')
    stepSlide(1)
    expect(deck().slide).toBe('2-1')
    expect(getAllSlides().length).toBeGreaterThan(20)
  })

  it('gates Input Mode behind the team password and supports locking again', async () => {
    deck().setInputMode(false)
    deck().requestInputMode()
    expect(deck().inputMode).toBe(false)
    expect(deck().promptingPassword).toBe(true)

    const wrong = await deck().unlockWithPassword('wrong')
    expect(wrong).toBe(false)
    expect(deck().unlocked).toBe(false)
    expect(deck().inputMode).toBe(false)

    const right = await deck().unlockWithPassword(DEFAULT_EDIT_PASSWORD)
    expect(right).toBe(true)
    expect(deck().unlocked).toBe(true)
    expect(deck().editToken).toBeTruthy()
    expect(deck().inputMode).toBe(true)
    expect(deck().promptingPassword).toBe(false)

    deck().lockInputMode()
    expect(deck().unlocked).toBe(false)
    expect(deck().editToken).toBeNull()
    expect(deck().inputMode).toBe(false)
  })

  it('hydrates sections, boxes, and backdrop from a decrypted cloud snapshot', () => {
    const customSections = structuredClone(SEED_SECTIONS)
    customSections[0].backdrop = 'purple'
    deck().replaceDeckFromCloud({
      sections: customSections,
      boxes: [{ id: 'cloud-1', slide: '1-1', text: 'Synced from cloud', x: 0.1, y: 0.2, style: 'body', color: 'white', look: 'frosted' }],
      format: { style: 'heading', color: 'white', look: 'frosted' },
    })
    expect(deck().boxes).toHaveLength(1)
    expect(deck().boxes[0].text).toBe('Synced from cloud')
    expect(useStage.getState().backdrop).toBe('purple')
  })
})

describe('the Medications section', () => {
  it('gives every slide a unique id, a title and some text', () => {
    const ids = MEDICATION_SLIDES.map((slide) => slide.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const slide of MEDICATION_SLIDES) {
      expect(slide.title).toBeTruthy()
      expect(slide.boxes.length).toBeGreaterThan(0)
    }
  })

  it('always labels the CSTC loop as a proposed model', () => {
    const cstc = MEDICATION_SLIDES.find((slide) => slide.title.includes('CSTC'))!
    expect(cstc.boxes.map((box) => box.text).join(' ')).toMatch(/proposed model/i)
  })

  it('leaves the brain idle on buspirone, whose site of action is unknown', () => {
    const buspirone = MEDICATION_SLIDES.find((slide) => slide.title === 'Buspirone')!
    expect(buspirone.focus).toEqual({ regions: [], circuits: [] })
  })

  it('starts a new browser with every slide filled in across all sections', () => {
    expect(useDeck.getInitialState().boxes).toEqual(ALL_SEED_BOXES)
    expect(useDeck.getInitialState().sections).toEqual(SEED_SECTIONS)
  })

  it('adds its slides and sections to a browser that already saved boxes, keeping those boxes', () => {
    const mine = { id: 'mine', slide: '2', text: 'My notes', x: 0.1, y: 0.1, style: 'body', color: 'white', look: 'clear' }
    const format = { style: 'heading', color: 'grey', look: 'clear' }
    const migrated = useDeck.persist.getOptions().migrate!({ boxes: [mine], format }, 1) as {
      sections: unknown[]
      boxes: unknown[]
      format: unknown
    }
    expect(migrated.boxes).toEqual([mine, ...SEED_BOXES, ...NON_MEDICATION_SEED_BOXES])
    expect(migrated.sections).toEqual(SEED_SECTIONS)
    expect(migrated.format).toEqual(format)
  })
})
