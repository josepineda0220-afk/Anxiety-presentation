import { useEffect } from 'react'
import { useDeck } from './deckStore'

/** True while the user is typing somewhere, so shortcut keys must be left alone. */
export function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/**
 * I toggles input mode. In input mode: Esc steps back out (stop typing, then deselect, then leave),
 * Enter edits the selected box, and Delete or Backspace removes it.
 */
export function useDeckKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const deck = useDeck.getState()

      if (event.key === 'Escape') {
        if (deck.editingId) {
          deck.stopEditing()
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        } else if (deck.selectedId) deck.select(null)
        else if (deck.inputMode) deck.setInputMode(false)
        return
      }

      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'i' || event.key === 'I') {
        deck.setInputMode(!deck.inputMode)
        return
      }

      const id = deck.inputMode ? deck.selectedId : null
      if (!id) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deck.removeBox(id)
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        deck.startEditing(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
