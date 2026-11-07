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

const deck = () => useDeck.getState()
const only = () => {
  expect(deck().boxes).toHaveLength(1)
  return deck().boxes[0]
}

beforeEach(() => {
  useDeck.setState({
    slide: '1',
    inputMode: true,
    selectedId: null,
    editingId: null,
    boxes: [],
    format: { style: 'body', color: 'white', look: 'clear' },
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
    deck().addBox()
    deck().setSlide('2')
    deck().addBox()
    deck().setSlide('1')
    expect(deck().boxes.map((b) => b.slide)).toEqual(['1', '2'])
    expect(deck().selectedId).toBeNull()
  })
})

describe('saving', () => {
  it('keeps the boxes and format, not the mode or selection', () => {
    deck().addBox()
    deck().addBox()
    deck().updateBox(deck().boxes[1].id, { text: '' })
    const stored = JSON.parse(localStorage.getItem('anxiety-presentation:deck')!).state
    expect(Object.keys(stored).sort()).toEqual(['boxes', 'format'])
    // The box still being emptied is left out.
    expect(stored.boxes).toHaveLength(1)
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

  it('starts a new browser with every slide filled in', () => {
    expect(useDeck.getInitialState().boxes).toEqual(SEED_BOXES)
  })

  it('adds its slides to a browser that already saved boxes, keeping those boxes', () => {
    const mine = { id: 'mine', slide: '2', text: 'My notes', x: 0.1, y: 0.1, style: 'body', color: 'white', look: 'clear' }
    const format = { style: 'heading', color: 'grey', look: 'clear' }
    const migrated = useDeck.persist.getOptions().migrate!({ boxes: [mine], format }, 1) as {
      boxes: unknown[]
      format: unknown
    }
    expect(migrated.boxes).toEqual([mine, ...SEED_BOXES])
    expect(migrated.format).toEqual(format)
  })
})
