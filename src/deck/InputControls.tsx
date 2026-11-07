import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useDeck, type BoxLook, type TextColor, type TextStyle } from './deckStore'
import { useDeckKeys } from './keys'
import { goToSlide, SLIDES } from './slides'

const STYLES: { value: TextStyle; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'heading', label: 'Heading' },
  { value: 'body', label: 'Body' },
  { value: 'small', label: 'Small' },
]

const COLORS: { value: TextColor; label: string }[] = [
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'grey', label: 'Grey' },
]

const LOOKS: { value: BoxLook; label: string }[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'frosted', label: 'Frosted' },
]

export function InputControls() {
  const inputMode = useDeck((s) => s.inputMode)
  useDeckKeys()
  return (
    <>
      {!inputMode && <EnterButton />}
      <AnimatePresence>{inputMode && <Toolbar key="toolbar" />}</AnimatePresence>
    </>
  )
}

/** True for a few seconds after the pointer moves, so controls stay out of the way while presenting. */
function usePointerActive(ms: number) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    let timer = 0
    const wake = () => {
      setActive(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setActive(false), ms)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.clearTimeout(timer)
    }
  }, [ms])
  return active
}

function EnterButton() {
  const active = usePointerActive(2500)
  return (
    <button
      type="button"
      className="input-toggle"
      data-active={active || undefined}
      title="Input mode (I)"
      onClick={() => useDeck.getState().setInputMode(true)}
    >
      <Icon d="M10.6 2.6l2.8 2.8L5.2 13.6H2.4v-2.8z M9 4.2l2.8 2.8" />
      Input mode
    </button>
  )
}

function Toolbar() {
  const slide = useDeck((s) => s.slide)
  const selected = useDeck((s) => s.boxes.find((box) => box.id === s.selectedId))
  const format = useDeck((s) => s.format)
  const deck = useDeck.getState()
  // With a box selected the controls show and change that box. Otherwise they set up the next one.
  const shown = selected ?? format

  return (
    <div className="toolbar-dock">
      <motion.p
        className="toolbar-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        Drag a box to move it · Drag its handles to resize · Double-click to type · Delete removes it · Esc when done
      </motion.p>
      <motion.div
        className="toolbar"
        role="toolbar"
        aria-label="Input mode"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        // A click here must not pull focus out of a box that is being typed in.
        onMouseDown={(event) => event.preventDefault()}
      >
        <div className="tool-group" aria-label="Slide">
          <span className="tool-label">Slide</span>
          {SLIDES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="tool-slide"
              aria-pressed={s.id === slide}
              title={s.title}
              onClick={() => goToSlide(s.id)}
            >
              {s.id}
            </button>
          ))}
        </div>

        <span className="tool-sep" />

        <button type="button" className="tool-add" onClick={deck.addBox}>
          <Icon d="M8 3v10 M3 8h10" />
          Text box
        </button>

        <span className="tool-sep" />

        <Choice label="Text style" value={shown.style} options={STYLES} onChange={(style) => deck.applyFormat({ style })}>
          {(option) => (
            <span className="tool-style" data-style={option.value}>
              {option.label}
            </span>
          )}
        </Choice>

        <span className="tool-sep" />

        <Choice label="Text colour" value={shown.color} options={COLORS} onChange={(color) => deck.applyFormat({ color })} swatches>
          {(option) => <span className="swatch" data-color={option.value} />}
        </Choice>

        <span className="tool-sep" />

        <Choice label="Box" value={shown.look} options={LOOKS} onChange={(look) => deck.applyFormat({ look })}>
          {(option) => option.label}
        </Choice>

        <span className="tool-sep" />

        <button
          type="button"
          className="tool-icon"
          disabled={!selected}
          title="Delete text box (Delete)"
          aria-label="Delete text box"
          onClick={() => selected && deck.removeBox(selected.id)}
        >
          <Icon d="M3 4.5h10 M6.3 4.5V2.8h3.4v1.7 M4.6 4.5l.6 8.7h5.6l.6-8.7" />
        </button>

        <button type="button" className="tool-done" title="Leave input mode (Esc)" onClick={() => deck.setInputMode(false)}>
          Done
        </button>
      </motion.div>
    </div>
  )
}

interface ChoiceProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  children: (option: { value: T; label: string }) => ReactNode
  swatches?: boolean
}

/** A row of buttons where exactly one is on. */
function Choice<T extends string>({ label, value, options, onChange, children, swatches }: ChoiceProps<T>) {
  return (
    <div className="tool-group" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={swatches ? option.label : undefined}
          title={swatches ? `${option.label} text` : undefined}
          className={swatches ? 'tool-swatch' : undefined}
          onClick={() => onChange(option.value)}
        >
          {children(option)}
        </button>
      ))}
    </div>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
