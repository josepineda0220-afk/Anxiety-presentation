import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif'
import './styles.css'
import { BrainStage } from './stage/BrainStage'
import { InputControls } from './deck/InputControls'
import { TextLayer } from './deck/TextLayer'
import { isTyping } from './deck/keys'
import { goToSlide } from './deck/slides'

function App() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A number typed into a text box is text, not a slide change.
      if (!isTyping(event.target)) goToSlide(event.key)
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
