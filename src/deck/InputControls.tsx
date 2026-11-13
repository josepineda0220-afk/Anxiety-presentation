import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DEFAULT_CURSOR_EFFECT, type BackdropTheme, type CursorEffect } from '../data/sections'
import { useSyncStatus } from '../sync/syncStatus'
import { useDeck, type BoxLook, type TextColor, type TextStyle } from './deckStore'
import { useDeckKeys } from './keys'
import { PasswordGate } from './PasswordGate'
import { goToSection, goToSlide } from './slides'

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

const CURSOR_EFFECTS: { value: CursorEffect; label: string; hint: string }[] = [
  { value: 'part', label: 'Move away', hint: 'dots move out of the cursor’s way' },
  { value: 'ripple', label: 'Ripple', hint: 'ripples spread through the background from the cursor' },
  { value: 'off', label: 'Off', hint: 'the background ignores the cursor' },
]

const BACKDROPS: { value: BackdropTheme; label: string }[] = [
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Lavender' },
]

export function InputControls() {
  const inputMode = useDeck((s) => s.inputMode)
  const promptingPassword = useDeck((s) => s.promptingPassword)
  useDeckKeys()
  return (
    <>
      {!inputMode && <EnterButton />}
      <AnimatePresence>{promptingPassword && <PasswordGate key="password-gate" />}</AnimatePresence>
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
  const unlocked = useDeck((s) => s.unlocked)
  return (
    <button
      type="button"
      className="input-toggle"
      data-active={active || undefined}
      title="Input mode (I)"
      onClick={() => useDeck.getState().requestInputMode()}
    >
      {unlocked ? (
        <Icon d="M10.6 2.6l2.8 2.8L5.2 13.6H2.4v-2.8z M9 4.2l2.8 2.8" />
      ) : (
        <Icon d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7 M3.5 7h9v6.5h-9z" />
      )}
      Input mode
    </button>
  )
}

function SyncBadge() {
  const status = useSyncStatus((s) => s.status)
  const errorMessage = useSyncStatus((s) => s.errorMessage)

  const label =
    status === 'synced'
      ? 'E2EE Synced'
      : status === 'saving'
        ? 'Encrypting…'
        : status === 'connecting'
          ? 'Connecting…'
          : status === 'error'
            ? 'Sync error'
            : 'Local E2EE'

  return (
    <button
      type="button"
      className="sync-badge"
      data-status={status}
      title={errorMessage ?? 'AES-256-GCM end-to-end encrypted storage. Click to sync now.'}
      onClick={() => void import('../sync/cloudSync').then((m) => m.pushDeckToCloud())}
    >
      <span className="sync-dot" data-status={status} />
      {label}
    </button>
  )
}

function Toolbar() {
  const slide = useDeck((s) => s.slide)
  const sections = useDeck((s) => s.sections)
  const selected = useDeck((s) => s.boxes.find((box) => box.id === s.selectedId))
  const format = useDeck((s) => s.format)
  const deck = useDeck.getState()

  const activeSection = sections.find((sec) => sec.slides.some((sl) => sl.id === slide)) ?? sections[0]
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  // With a box selected the controls show and change that box. Otherwise they set up the next one.
  const shown = selected ?? format

  const commitRename = () => {
    if (renamingId && draftTitle.trim()) {
      deck.renameSection(renamingId, draftTitle)
    }
    setRenamingId(null)
  }

  return (
    <div className="toolbar-dock">
      <motion.p
        className="toolbar-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        Drag a box to move it · Drag its handles to resize · Double-click a box or section tab to edit text · Esc when done
      </motion.p>

      <motion.div
        className="toolbar section-toolbar"
        role="toolbar"
        aria-label="Sections and background"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onMouseDown={(event) => {
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
        }}
      >
        <div className="tool-group section-tabs" aria-label="Sections">
          <span className="tool-label">Section</span>
          {sections.map((sec, index) => {
            const isActive = sec.id === activeSection?.id
            if (renamingId === sec.id) {
              return (
                <input
                  key={sec.id}
                  className="section-rename-input"
                  value={draftTitle}
                  autoFocus
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              )
            }
            return (
              <button
                key={sec.id}
                type="button"
                className="tool-section"
                aria-pressed={isActive}
                title={`${index + 1}. ${sec.title} (double-click to rename)`}
                onClick={() => goToSection(sec.id)}
                onDoubleClick={() => {
                  setRenamingId(sec.id)
                  setDraftTitle(sec.title)
                }}
              >
                <span className="section-theme-dot" data-backdrop={sec.backdrop} />
                <span>
                  {index + 1}. {sec.title}
                </span>
              </button>
            )
          })}
        </div>

        <span className="tool-sep" />

        <div className="tool-group" aria-label="Manage sections">
          <button
            type="button"
            className="tool-action"
            title="Add new section"
            onClick={() => deck.addSection()}
          >
            <Icon d="M8 3v10 M3 8h10" />
            Section
          </button>
          <button
            type="button"
            className="tool-icon"
            disabled={sections.length <= 1}
            title="Remove current section"
            aria-label="Remove current section"
            onClick={() => activeSection && deck.removeSection(activeSection.id)}
          >
            <Icon d="M3 8h10" />
          </button>
        </div>

        <span className="tool-sep" />

        {activeSection && (
          <div className="tool-group" role="radiogroup" aria-label="Section background">
            <span className="tool-label">Backdrop</span>
            {BACKDROPS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={activeSection.backdrop === option.value}
                className="tool-backdrop"
                title={`Set "${activeSection.title}" background to ${option.label}`}
                onClick={() => deck.setSectionBackdrop(activeSection.id, option.value)}
              >
                <span className="swatch backdrop-swatch" data-backdrop={option.value} />
                {option.label}
              </button>
            ))}
          </div>
        )}

        {activeSection && (
          <>
            <span className="tool-sep" />
            <div className="tool-group" role="radiogroup" aria-label="Section cursor effect">
              <span className="tool-label">Cursor</span>
              {CURSOR_EFFECTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={(activeSection.cursorEffect ?? DEFAULT_CURSOR_EFFECT) === option.value}
                  className="tool-backdrop"
                  title={`In "${activeSection.title}", ${option.hint}`}
                  onClick={() => deck.setSectionCursorEffect(activeSection.id, option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </motion.div>

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
        {activeSection && (
          <div className="tool-group" aria-label="Slide">
            <span className="tool-label">Slide</span>
            {activeSection.slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                className="tool-slide"
                aria-pressed={s.id === slide}
                title={s.title}
                onClick={() => goToSlide(s.id)}
              >
                {idx + 1}
              </button>
            ))}
            <button
              type="button"
              className="tool-icon"
              title="Add slide to this section"
              aria-label="Add slide to this section"
              onClick={() => deck.addSlide(activeSection.id)}
            >
              <Icon d="M8 3.5v9 M3.5 8h9" />
            </button>
            <button
              type="button"
              className="tool-icon"
              disabled={activeSection.slides.length <= 1}
              title="Remove current slide from this section"
              aria-label="Remove current slide from this section"
              onClick={() => deck.removeSlide(slide)}
            >
              <Icon d="M3.5 8h9" />
            </button>
          </div>
        )}

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

        <span className="tool-sep" />

        <SyncBadge />

        <button
          type="button"
          className="tool-icon"
          title="Lock Input mode (require password again)"
          aria-label="Lock Input mode"
          onClick={() => deck.lockInputMode()}
        >
          <Icon d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7 M3.5 7h9v6.5h-9z" />
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
