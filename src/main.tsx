import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif'
import './styles.css'
import { BrainStage } from './stage/BrainStage'
import { InputControls } from './deck/InputControls'
import { TextLayer } from './deck/TextLayer'
import { isTyping } from './deck/keys'
import { goToSlide, stepSlide } from './deck/slides'

function App() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A key pressed in a text box is text, not a slide change.
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      // PageDown and PageUp are what presentation clickers send.
      if (event.key === 'ArrowRight' || event.key === 'PageDown') stepSlide(1)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') stepSlide(-1)
      // Space presses a focused button, so it only moves on when there isn't one.
      else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) stepSlide(1)
      else goToSlide(event.key)
    }
    window.addEventListener('keydown', onKey)
    goToSlide(new URLSearchParams(location.search).get('view') ?? '1')
    return () => window.removeEventListener('keydown', onKey)
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
