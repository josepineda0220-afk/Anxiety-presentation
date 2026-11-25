import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { motion } from 'motion/react'
import { useDeck, type TextBox, type TextStyle } from './deckStore'
import { drawBox, readSelection, readText, showsBox, writeSelection } from './editable'
import { charFormats, formattedLines } from './format'
import { dragSize, fitSize, type ResizeHandle } from './resize'

/** Pixels in one stage unit: 1% of the width of a 16:9 frame fitted in the window. Matches --u. */
export function unitPx() {
  return Math.min(window.innerWidth, (window.innerHeight * 16) / 9) / 100
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

interface Gesture {
  /** The handle being dragged. Left out, the whole box is moving. */
  handle?: ResizeHandle
  pointerX: number
  pointerY: number
  rect: DOMRect
  moved: boolean
}

type Live = Partial<Pick<TextBox, 'x' | 'y' | 'width' | 'height'>>

/** The widest each size lets a box grow, in stage units. Matches --tb-max in deck.css. */
const MAX_WIDTH: Record<TextStyle, number> = { title: 48, heading: 40, body: 34, small: 34 }

/** The text when it isn't being typed in. A wrapped bullet lines up under its words, not its dot. */
function ShownText({ box }: { box: TextBox }) {
  const mixed = box.sizes !== undefined || box.colors !== undefined
  return (
    <div className="tb-text">
      {formattedLines(box).map((line, index) => (
        <div
          key={index}
          className={line.bullet ? 'tb-bullet' : 'tb-line'}
          data-size={mixed ? line.style : undefined}
          data-color={mixed ? line.color : undefined}
        >
          {mixed
            ? line.segments.map((segment, at) => (
                <span key={at} data-size={segment.style} data-color={segment.color}>
                  {segment.text}
                </span>
              ))
            : line.segments[0]?.text}
        </div>
      ))}
    </div>
  )
}

/** Redraws the editable text if it differs from the box, leaving the caret where it was. */
function syncEditable(element: HTMLElement, box: TextBox) {
  if (showsBox(element, box)) return
  const held = document.activeElement === element ? readSelection(element) : null
  drawBox(element, box)
  if (held) writeSelection(element, held)
}

/** The caret position under a point, if it falls inside an element. */
function caretRangeAt(x: number, y: number, within: HTMLElement): Range | null {
  // Older Safari only has the second of these.
  const doc: Partial<Pick<Document, 'caretPositionFromPoint' | 'caretRangeFromPoint'>> = document
  let range: Range | null = null
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y)
    if (position) {
      range = document.createRange()
      range.setStart(position.offsetNode, position.offset)
    }
  } else if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(x, y)
  }
  return range && within.contains(range.startContainer) ? range : null
}

let toolbarPressAt = -Infinity

/**
 * Called when a toolbar press starts. On a touch screen a tap can take focus out of the text before
 * the button acts, which would end the edit and send a size or colour to the whole box.
 */
export function noteToolbarPress() {
  toolbarPressAt = performance.now()
}

const pressingToolbar = () => performance.now() - toolbarPressAt < 1500

function allTextOf(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range
}

export function TextBoxView({ box }: { box: TextBox }) {
  const inputMode = useDeck((s) => s.inputMode)
  const selected = useDeck((s) => s.selectedId === box.id)
  const editing = useDeck((s) => s.editingId === box.id)

  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  /** True while an input method is assembling a character, when the text must not be redrawn. */
  const composing = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  const caretAt = useRef<{ x: number; y: number } | null>(null)
  // Position and width follow the pointer locally, and are saved once when the drag ends.
  const liveRef = useRef<Live | null>(null)
  const [live, setLiveState] = useState<Live | null>(null)
  const setLive = (next: Live | null) => {
    liveRef.current = next
    setLiveState(next)
  }

  // While editing, the browser owns the text. It is only redrawn when a size or colour changes, or
  // when what was typed landed in a different one than it should have, and the caret is put back.
  useLayoutEffect(() => {
    if (!composing.current) syncEditable(textRef.current!, box)
  }, [box, editing])

  // Starting an edit: caret where the double-click was, or the whole text selected to type over.
  useEffect(() => {
    if (!editing) return
    const element = textRef.current!
    element.focus({ preventScroll: true })
    const point = caretAt.current
    caretAt.current = null
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange((point && caretRangeAt(point.x, point.y, element)) || allTextOf(element))
    return () => window.getSelection()?.removeAllRanges()
  }, [editing])

  // The toolbar needs to know what is selected.
  useEffect(() => {
    if (!editing) return
    const report = () => {
      // Out of the text (a tap on the toolbar), the selection there is kept for the toolbar to use.
      if (document.activeElement !== textRef.current) return
      const at = readSelection(textRef.current!)
      if (at) useDeck.getState().setTextCursor(box.id, Math.min(at.anchor, at.focus), Math.max(at.anchor, at.focus))
    }
    report()
    document.addEventListener('selectionchange', report)
    return () => document.removeEventListener('selectionchange', report)
  }, [editing, box.id])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!inputMode || event.button !== 0) return
    const target = event.target as HTMLElement
    const handle = target.dataset.handle as ResizeHandle | undefined
    // Inside text that is being edited, a press just places the caret.
    if (editing && !handle) return
    // Keeps the caret in the text while the box changes size.
    if (handle) event.preventDefault()
    useDeck.getState().select(box.id)
    gesture.current = {
      handle,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect: boxRef.current!.getBoundingClientRect(),
      moved: false,
    }
    ;(handle ? target : event.currentTarget).setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const dx = event.clientX - g.pointerX
    const dy = event.clientY - g.pointerY
    if (!g.moved && Math.hypot(dx, dy) < 3) return
    g.moved = true
    const { innerWidth: width, innerHeight: height } = window
    if (g.handle) {
      setLive(dragSize({ handle: g.handle, rect: g.rect, dx, dy, unit: unitPx(), screen: { width, height } }))
    } else {
      setLive({
        x: clamp(box.x + dx / width, 0, 1 - g.rect.width / width),
        y: clamp(box.y + dy / height, 0, 1 - g.rect.height / height),
      })
    }
  }

  const endGesture = (save: boolean) => {
    const g = gesture.current
    const changes = liveRef.current
    gesture.current = null
    setLive(null)
    if (save && g?.moved && changes) useDeck.getState().updateBox(box.id, changes)
  }

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!inputMode) return
    const deck = useDeck.getState()
    const handle = (event.target as HTMLElement).dataset.handle as ResizeHandle | undefined
    if (handle) {
      deck.updateBox(box.id, fitSize(handle))
      return
    }
    caretAt.current = { x: event.clientX, y: event.clientY }
    deck.startEditing(box.id)
  }

  const shown = { ...box, ...live }
  const chars = box.sizes || box.colors ? charFormats(box) : null
  const widest = chars ? Math.max(...chars.map(({ style }) => MAX_WIDTH[style])) : undefined
  // Frosted glass is pale for black text and dark otherwise, so it follows most of the text.
  const tone = chars
    ? chars.filter(({ color }) => color === 'black').length * 2 > chars.length
      ? 'black'
      : (chars.find(({ color }) => color !== 'black')?.color ?? 'white')
    : box.color
  return (
    <motion.div
      ref={boxRef}
      className="tb"
      data-style={box.style}
      data-mixed={chars ? true : undefined}
      data-color={tone}
      data-look={box.look}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      data-moving={live?.x !== undefined || undefined}
      style={{
        left: `${shown.x * 100}%`,
        top: `${shown.y * 100}%`,
        ...(widest !== undefined && { ['--tb-max' as string]: widest }),
        ...(shown.width !== undefined && { width: `calc(var(--u) * ${shown.width.toFixed(2)})`, maxWidth: 'none' }),
        // A minimum, so a box always grows to hold its text and nothing is ever cut off.
        ...(shown.height !== undefined && { minHeight: `calc(var(--u) * ${shown.height.toFixed(2)})` }),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endGesture(true)}
      onPointerCancel={() => endGesture(false)}
      onDoubleClick={onDoubleClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div
        ref={textRef}
        className="tb-text"
        hidden={!editing}
        contentEditable={editing ? 'plaintext-only' : false}
        spellCheck={editing}
        onInput={(event) => {
          const element = event.currentTarget
          useDeck.getState().typeText(box.id, readText(element), readSelection(element)?.focus)
        }}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(event) => {
          composing.current = false
          const latest = useDeck.getState().boxes.find((b) => b.id === box.id)
          if (latest) syncEditable(event.currentTarget, latest)
        }}
        onBlur={(event) => {
          const element = event.currentTarget
          const deck = useDeck.getState()
          if (deck.editingId !== box.id) return
          const toToolbar = event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-keeps-typing]')
          if (toToolbar || pressingToolbar()) {
            // Still typing: once the button has acted, focus and the selection come back to the text.
            const restore = () => {
              window.removeEventListener('click', restore)
              const s = useDeck.getState()
              if (s.editingId !== box.id || document.activeElement === element) return
              element.focus({ preventScroll: true })
              const at = s.textCursor
              if (at?.boxId === box.id) writeSelection(element, { anchor: at.start, focus: at.end })
            }
            window.addEventListener('click', restore)
            window.setTimeout(restore, 700)
            return
          }
          // Switching to another window is not the end of an edit.
          if (document.hasFocus()) deck.stopEditing()
        }}
      />
      {!editing && <ShownText box={box} />}
      {inputMode && selected && (
        <>
          <div className="tb-handle" data-handle="width" title="Drag to set the width. Double-click to fit the text." />
          <div className="tb-handle" data-handle="height" title="Drag to set the length. Double-click to fit the text." />
          <div className="tb-handle" data-handle="both" title="Drag to set the length and width. Double-click to fit the text." />
        </>
      )}
    </motion.div>
  )
}
