import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif'
import './styles.css'
import { BrainStage } from './stage/BrainStage'
import { useStage } from './stage/focusStore'
import type { Focus } from './brain/regions'

const VIEWS: Record<string, Focus> = {
  '1': { regions: [], circuits: [] },
  '2': { regions: ['amygdala'], circuits: [] },
  '3': { regions: [], circuits: ['cstc'] },
  '4': { regions: ['amygdala'], circuits: ['cstc'] },
}

function App() {
  useEffect(() => {
    const pick = (key: string) => {
      const view = VIEWS[key]
      if (view) useStage.getState().setFocus(view)
    }
    const onKey = (event: KeyboardEvent) => pick(event.key)
    window.addEventListener('keydown', onKey)
    pick(new URLSearchParams(location.search).get('view') ?? '1')
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return <BrainStage />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
