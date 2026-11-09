import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { useDeck } from './deckStore'

export function PasswordGate() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password.trim() || verifying) return
    setVerifying(true)
    setError(null)
    try {
      const ok = await useDeck.getState().unlockWithPassword(password)
      if (!ok) {
        setError('Incorrect team password. Please try again.')
      }
    } catch {
      setError('Could not verify password in this browser.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <motion.div
      className="password-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) useDeck.getState().cancelPasswordPrompt()
      }}
    >
      <motion.form
        className="password-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-gate-title"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onSubmit={onSubmit}
      >
        <div className="password-header">
          <span className="password-badge">AES-256-GCM E2EE</span>
          <h2 id="password-gate-title" className="password-title">
            Unlock Input Mode
          </h2>
          <p className="password-desc">
            Enter the team password to edit slides, sections, and sync encrypted changes to the cloud.
          </p>
        </div>

        <input
          type="password"
          className="password-input"
          placeholder="Team password"
          value={password}
          autoFocus
          autoComplete="current-password"
          onChange={(e) => {
            setPassword(e.target.value)
            if (error) setError(null)
          }}
        />

        {error && (
          <p className="password-error" role="alert">
            {error}
          </p>
        )}

        <div className="password-actions">
          <button
            type="button"
            className="password-cancel"
            onClick={() => useDeck.getState().cancelPasswordPrompt()}
          >
            Cancel
          </button>
          <button type="submit" className="password-submit" disabled={!password.trim() || verifying}>
            {verifying ? 'Verifying…' : 'Unlock'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}
