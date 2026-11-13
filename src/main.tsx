import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif'
import './styles.css'
import { BrainStage } from './stage/BrainStage'
import { useStageGestures } from './stage/useStageGestures'
import { useDeck } from './deck/deckStore'
import { InputControls } from './deck/InputControls'
import { TextLayer } from './deck/TextLayer'
import { isTyping } from './deck/keys'
import { goToSection, goToSlide, stepSlide } from './deck/slides'
import { isCloudConfigured } from './sync/config'

function App() {
  useStageGestures()
  useEffect(() => {
    // Firebase loads in its own chunk after the first paint, and not at all without the VITE_FIREBASE_* settings.
    let stopSync = () => {}
    let stopped = false
    if (isCloudConfigured()) {
      void import('./sync/cloudSync').then(({ startCloudSync }) => {
        if (!stopped) stopSync = startCloudSync()
      })
    }
    const onKey = (event: KeyboardEvent) => {
      // A key pressed in a text box is text, not a slide change.
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      // PageDown and PageUp are what presentation clickers send.
      if (event.key === 'ArrowRight' || event.key === 'PageDown') stepSlide(1)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') stepSlide(-1)
      // Space presses a focused button, so it only moves on when there isn't one.
      else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) stepSlide(1)
      else if (/^[1-9]$/.test(event.key)) goToSection(Number(event.key))
    }
    window.addEventListener('keydown', onKey)
    const initialView = new URLSearchParams(location.search).get('view')
    goToSlide(initialView ?? useDeck.getState().slide)
    return () => {
      window.removeEventListener('keydown', onKey)
      stopped = true
      stopSync()
    }
  }, [])
  return (
    <>
      <BrainStage />
      <TextLayer />
      <InputControls />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
