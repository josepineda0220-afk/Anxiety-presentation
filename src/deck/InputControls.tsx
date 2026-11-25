import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  DEFAULT_BRAIN_SIDE,
  DEFAULT_CURSOR_EFFECT,
  DEFAULT_PARTICLE_STYLE,
  type BackdropTheme,
  type BrainSide,
  type CursorEffect,
  type ParticleStyle,
} from '../data/sections'
import { useSyncLabel, useSyncStatus, type SyncStatus } from '../sync/syncStatus'
import { shownTextFormat, useDeck, type BoxLook, type TextColor, type TextStyle } from './deckStore'
import { useDeckKeys } from './keys'
import { PasswordGate } from './PasswordGate'
import { goToSection, goToSlide, stepSlide } from './slides'
import { beginEditing, finishEditing } from './TextBox'
import { mirrorShift } from './TextLayer'
import { ConflictPrompt, HistoryPanel } from './SyncDialogs'
import { noteToolbarPress } from './TextBox'

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
  { value: 'pink', label: 'Pink' },
  { value: 'black', label: 'Black' },
]

const BRAIN_SIDES: { value: BrainSide; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const COLLAPSED_KEY = 'deck-tools-collapsed'

/** Whether the toolbars are folded away, remembered on this device. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // Private browsing: it just won't be remembered.
    }
  }
  return [collapsed, set] as const
}

const PARTICLES: { value: ParticleStyle; label: string; hint: string }[] = [
  { value: 'plain', label: 'Plain', hint: 'the dots are soft plain specks' },
  { value: 'sparkle', label: 'Sparkle', hint: 'the dots glitter and catch the light' },
]

export function InputControls() {
  const inputMode = useDeck((s) => s.inputMode)
  const promptingPassword = useDeck((s) => s.promptingPassword)
  const [showHistory, setShowHistory] = useState(false)
  useDeckKeys()
  useEffect(() => {
    if (!inputMode) setShowHistory(false)
  }, [inputMode])
  return (
    <>
      {!inputMode && <EnterButton />}
      <AnimatePresence>{promptingPassword && <PasswordGate key="password-gate" />}</AnimatePresence>
      <AnimatePresence>{inputMode && <Toolbar key="toolbar" onShowHistory={() => setShowHistory(true)} />}</AnimatePresence>
      {/* Dialogs sit outside the toolbar dock, which lets clicks through to the stage. */}
      <AnimatePresence>
        {inputMode && showHistory && <HistoryPanel key="history" onClose={() => setShowHistory(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        <ConflictPrompt key="conflict" />
      </AnimatePresence>
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

const STATUS_LABELS: Record<SyncStatus, string> = {
  local: 'View only',
  connecting: 'Connecting…',
  saved: 'Saved',
  saving: 'Saving…',
  conflict: 'Conflict',
  offline: 'Offline',
  error: 'Not saved',
}

function SyncBadge() {
  const status = useSyncLabel()
  const problem = useSyncStatus((s) => s.engine?.problem ?? null)
  const held = useSyncStatus((s) => s.engine?.held ?? 0)

  const hint =
    status === 'offline'
      ? 'You’re offline. Your changes will save when you reconnect.'
      : status === 'error'
        ? problem
        : status === 'conflict'
          ? 'Someone else changed the same part. Choose which version to keep.'
          : held > 0
            ? 'Someone else changed the box you’re typing in. You’ll see both versions when you finish.'
            : status === 'saved'
              ? 'Every change is saved, and everyone sees it live.'
              : null

  return (
    <span className="sync-badge" role="status" aria-live="polite" title={hint ?? undefined}>
      <span className="sync-dot" data-status={held > 0 && status === 'saved' ? 'saving' : status} />
      {held > 0 && (status === 'saved' || status === 'saving') ? 'Edited elsewhere' : STATUS_LABELS[status]}
    </span>
  )
}

function Toolbar({ onShowHistory }: { onShowHistory: () => void }) {
  const slide = useDeck((s) => s.slide)
  const sections = useDeck((s) => s.sections)
  const selected = useDeck((s) => s.boxes.find((box) => box.id === s.selectedId))
  const editingId = useDeck((s) => s.editingId)
  const [collapsed, setCollapsed] = useCollapsed()
  // The kind of pointer that pressed a section tab: a tap on the open tab renames it on a touch screen.
  const tabPointer = useRef('mouse')
  const format = useDeck((s) => s.format)
  const textStyle = useDeck((s) => shownTextFormat(s, 'style'))
  const textColor = useDeck((s) => shownTextFormat(s, 'color'))
  const deck = useDeck.getState()

  const activeSection = sections.find((sec) => sec.slides.some((sl) => sl.id === slide)) ?? sections[0]
  const currentSlide = activeSection?.slides.find((sl) => sl.id === slide)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  // With a box selected the box controls show and change that box. Otherwise they set up the next one.
  const shown = selected ?? format

  const startRename = (id: string, title: string) => {
    // Rendered at once, so the field takes focus inside the tap and the on-screen keyboard opens.
    flushSync(() => {
      setRenamingId(id)
      setDraftTitle(title)
    })
  }

  // The text moves across to the other side with the brain.
  const setSide = (slideId: string, side: BrainSide) => {
    const current = sections.flatMap((sec) => sec.slides).find((sl) => sl.id === slideId)
    if ((current?.side ?? DEFAULT_BRAIN_SIDE) === side) return
    deck.setSlideSide(slideId, side, mirrorShift(slideId))
  }

  // A new slide keeps the brain's side, so its starter text, laid out for the left, moves across too.
  const addSlide = (sectionId: string) => {
    let added: ReturnType<typeof deck.addSlide> = null
    flushSync(() => {
      added = deck.addSlide(sectionId)
    })
    const slideAdded = added as ReturnType<typeof deck.addSlide>
    if (slideAdded?.side === 'left') deck.setSlideSide(slideAdded.id, 'left', mirrorShift(slideAdded.id))
  }

  const addSection = () => {
    const added = deck.addSection()
    // Straight into naming it, with the placeholder name selected to type over.
    startRename(added.id, added.title)
  }

  const removeSection = () => {
    if (!activeSection) return
    const slides = activeSection.slides.length
    const message = `Remove the section "${activeSection.title}" and its ${slides} slide${slides === 1 ? '' : 's'}?`
    if (window.confirm(message)) deck.removeSection(activeSection.id)
  }

  const addBox = () => {
    flushSync(() => deck.addBox())
    const id = useDeck.getState().editingId
    if (id) beginEditing(id)
  }

  const commitRename = () => {
    if (renamingId && draftTitle.trim()) {
      deck.renameSection(renamingId, draftTitle)
    }
    setRenamingId(null)
  }

  const slideIndex = activeSection ? activeSection.slides.findIndex((s) => s.id === slide) : -1
  const sectionIndex = activeSection ? sections.indexOf(activeSection) : -1
  const editButton = editingId ? (
    <button type="button" className="tool-action" title="Finish typing (Esc)" onClick={finishEditing}>
      <Icon d="M3.5 8.5l3 3 6-7" />
      Finish
    </button>
  ) : (
    <button
      type="button"
      className="tool-action"
      disabled={!selected}
      title="Edit the selected box's text (Enter)"
      onClick={() => selected && beginEditing(selected.id)}
    >
      <Icon d="M10.6 2.6l2.8 2.8L5.2 13.6H2.4v-2.8z" />
      Edit text
    </button>
  )

  if (collapsed) {
    return (
      <div className="toolbar-dock">
        <motion.div
          className="toolbar toolbar-compact"
          role="toolbar"
          aria-label="Input mode"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="tool-action"
            title="Show all the tools"
            aria-expanded={false}
            onClick={() => setCollapsed(false)}
          >
            <Icon d="M4 10l4-4 4 4" />
            Tools
          </button>
          {activeSection && (
            <div className="tool-group" aria-label="Slide">
              <button type="button" className="tool-icon" title="Previous slide" aria-label="Previous slide" onClick={() => stepSlide(-1)}>
                <Icon d="M10 3.5L5.5 8l4.5 4.5" />
              </button>
              <span className="tool-where" title={`${activeSection.title}, slide ${slideIndex + 1}`}>
                {sectionIndex + 1}.{slideIndex + 1}
              </span>
              <button type="button" className="tool-icon" title="Next slide" aria-label="Next slide" onClick={() => stepSlide(1)}>
                <Icon d="M6 3.5L10.5 8 6 12.5" />
              </button>
            </div>
          )}
          <span className="tool-sep" />
          <button type="button" className="tool-add" onClick={addBox}>
            <Icon d="M8 3v10 M3 8h10" />
            Text box
          </button>
          {editButton}
          <span className="tool-sep" />
          <SyncBadge />
          <button type="button" className="tool-done" title="Leave input mode (Esc)" onClick={() => deck.setInputMode(false)}>
            Done
          </button>
        </motion.div>
      </div>
    )
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
        Drag a box to move it · Drag its handles to resize · Double-click a box, or tap it again, to edit its text · Size and
        colour apply to selected words, or to what you type next · Fold the tools away with the arrow
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
                  onFocus={(e) => e.currentTarget.select()}
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
                title={`${index + 1}. ${sec.title} (double-click, or tap again, to rename)`}
                onPointerDown={(event) => {
                  tabPointer.current = event.pointerType
                }}
                onClick={() => {
                  if (isActive && tabPointer.current !== 'mouse') startRename(sec.id, sec.title)
                  else goToSection(sec.id)
                }}
                onDoubleClick={() => {
                  if (tabPointer.current === 'mouse') startRename(sec.id, sec.title)
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
          <button type="button" className="tool-action" title="Add a new section" onClick={addSection}>
            <Icon d="M8 3v10 M3 8h10" />
            Section
          </button>
          <button
            type="button"
            className="tool-action"
            disabled={!activeSection}
            title="Rename the current section"
            onClick={() => activeSection && startRename(activeSection.id, activeSection.title)}
          >
            <Icon d="M10.6 2.6l2.8 2.8L5.2 13.6H2.4v-2.8z" />
            Rename
          </button>
          <button
            type="button"
            className="tool-action"
            disabled={sections.length <= 1}
            title="Remove the current section and its slides"
            onClick={removeSection}
          >
            <Icon d="M3 4.5h10 M6.3 4.5V2.8h3.4v1.7 M4.6 4.5l.6 8.7h5.6l.6-8.7" />
            Remove
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
            <span className="tool-sep" />
            <div className="tool-group" role="radiogroup" aria-label="Section particles">
              <span className="tool-label">Dots</span>
              {PARTICLES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={(activeSection.particles ?? DEFAULT_PARTICLE_STYLE) === option.value}
                  className="tool-backdrop"
                  title={`In "${activeSection.title}", ${option.hint}`}
                  onClick={() => deck.setSectionParticles(activeSection.id, option.value)}
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
        data-keeps-typing
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        // A click here must not pull focus out of a box that is being typed in. A tap can, so the box
        // is told to keep typing and take focus back.
        onPointerDownCapture={noteToolbarPress}
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
              onClick={() => addSlide(activeSection.id)}
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

        {currentSlide && (
          <>
            <span className="tool-sep" />
            <div className="tool-group" role="radiogroup" aria-label="Brain side on this slide">
              <span className="tool-label">Brain</span>
              {BRAIN_SIDES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={(currentSlide.side ?? DEFAULT_BRAIN_SIDE) === option.value}
                  title={`Put the brain on the ${option.label.toLowerCase()} of this slide; the text moves to the other side`}
                  onClick={() => setSide(currentSlide.id, option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}

        <span className="tool-sep" />

        <button type="button" className="tool-add" onClick={addBox}>
          <Icon d="M8 3v10 M3 8h10" />
          Text box
        </button>

        {editButton}

        <span className="tool-sep" />

        <Choice
          label="Text size"
          value={textStyle}
          options={STYLES}
          onChange={(style) => deck.applyFormat({ style })}
          hint={(option) => `${option.label} size`}
        >
          {(option) => (
            <span className="tool-style" data-style={option.value}>
              {option.label}
            </span>
          )}
        </Choice>

        <span className="tool-sep" />

        <Choice label="Text colour" value={textColor} options={COLORS} onChange={(color) => deck.applyFormat({ color })} swatches>
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
          title="Version history"
          aria-label="Version history"
          onClick={onShowHistory}
        >
          <Icon d="M8 4.5V8l2.3 1.5 M2.6 8a5.4 5.4 0 1 0 1.6-3.8 M2.4 2.6v2.6H5" />
        </button>

        <button
          type="button"
          className="tool-icon"
          title="Lock Input mode (require password again)"
          aria-label="Lock Input mode"
          onClick={() => deck.lockInputMode()}
        >
          <Icon d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7 M3.5 7h9v6.5h-9z" />
        </button>

        <button
          type="button"
          className="tool-icon"
          title="Fold the tools away"
          aria-label="Fold the tools away"
          aria-expanded
          onClick={() => setCollapsed(true)}
        >
          <Icon d="M4 6l4 4 4-4" />
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
  /** Undefined when none of the options is on. */
  value: T | undefined
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  children: (option: { value: T; label: string }) => ReactNode
  swatches?: boolean
  hint?: (option: { value: T; label: string }) => string
}

/** A row of buttons where exactly one is on. */
function Choice<T extends string>({ label, value, options, onChange, children, swatches, hint }: ChoiceProps<T>) {
  return (
    <div className="tool-group" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={swatches ? option.label : undefined}
          title={swatches ? `${option.label} text` : hint?.(option)}
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
