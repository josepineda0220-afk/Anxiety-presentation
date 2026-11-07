import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { motion } from 'motion/react'
import { useDeck, type TextBox } from './deckStore'
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

const BULLET = /^•\s*/

/** The text when it isn't being typed in. A wrapped bullet lines up under its words, not its dot. */
function ShownText({ text }: { text: string }) {
  return (
    <div className="tb-text">
      {text.split('\n').map((line, index) =>
        BULLET.test(line) ? (
          <div key={index} className="tb-bullet">
            {line.replace(BULLET, '')}
          </div>
        ) : (
          <div key={index} className="tb-line">
            {line}
          </div>
        ),
      )}
    </div>
  )
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
  const filled = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  const caretAt = useRef<{ x: number; y: number } | null>(null)
  // Position and width follow the pointer locally, and are saved once when the drag ends.
  const liveRef = useRef<Live | null>(null)
  const [live, setLiveState] = useState<Live | null>(null)
  const setLive = (next: Live | null) => {
    liveRef.current = next
    setLiveState(next)
  }

  // While editing, the browser owns the text and React keeps out of it, or the caret would jump.
  useLayoutEffect(() => {
    const element = textRef.current!
    if ((!editing || !filled.current) && element.textContent !== box.text) element.textContent = box.text
    filled.current = true
  }, [box.text, editing])

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
  return (
    <motion.div
      ref={boxRef}
      className="tb"
      data-style={box.style}
      data-color={box.color}
      data-look={box.look}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      data-moving={live?.x !== undefined || undefined}
      style={{
        left: `${shown.x * 100}%`,
        top: `${shown.y * 100}%`,
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
        onInput={(event) => useDeck.getState().updateBox(box.id, { text: event.currentTarget.innerText })}
        onBlur={() => {
          // Switching to another window is not the end of an edit.
          const deck = useDeck.getState()
          if (document.hasFocus() && deck.editingId === box.id) deck.stopEditing()
        }}
      />
      {!editing && <ShownText text={box.text} />}
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
