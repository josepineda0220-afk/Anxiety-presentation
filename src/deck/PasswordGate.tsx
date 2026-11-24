import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { isEditingConfigured } from '../sync/config'
import type { SignInResult } from '../sync/firebase'
import { useSyncStatus } from '../sync/syncStatus'
import { useDeck } from './deckStore'

/** One message for every way a password can be wrong, so the screen gives nothing away. */
const MESSAGES: Record<Exclude<SignInResult, 'ok'>, string> = {
  wrong: 'That password didn’t work.',
  'rate-limited': 'Too many tries. Wait a minute, then try again.',
  offline: 'You’re offline. Connect to the internet, then try again.',
  unavailable: 'Editing isn’t set up for this copy of the deck.',
}

export function PasswordGate() {
  const unlocked = useDeck((s) => s.unlocked)
  const ready = useSyncStatus((s) => s.engine?.phase === 'ready')
  const problem = useSyncStatus((s) => s.engine?.problem ?? null)

  // Signed in, and the cloud deck has loaded: straight into input mode.
  useEffect(() => {
    if (unlocked && ready) useDeck.setState({ inputMode: true, promptingPassword: false })
  }, [unlocked, ready])

  if (!isEditingConfigured()) {
    return (
      <Dialog title="Editing is off">
        <p className="password-desc">{MESSAGES.unavailable}</p>
        <div className="password-actions">
          <button type="button" className="password-submit" onClick={() => useDeck.getState().cancelPasswordPrompt()}>
            Close
          </button>
        </div>
      </Dialog>
    )
  }

  if (unlocked) {
    return (
      <Dialog title="Unlock Input Mode">
        <p className="password-desc" role="status">
          {problem ?? 'Loading the latest deck…'}
        </p>
        <div className="password-actions">
          <button type="button" className="password-cancel" onClick={() => useDeck.getState().cancelPasswordPrompt()}>
            Cancel
          </button>
        </div>
      </Dialog>
    )
  }

  return <PasswordForm />
}

function PasswordForm() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || verifying) return
    setVerifying(true)
    setError(null)
    try {
      const result = await useDeck.getState().unlockWithPassword(password)
      if (result !== 'ok') setError(MESSAGES[result])
    } catch {
      setError(MESSAGES.offline)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Dialog title="Unlock Input Mode" onSubmit={onSubmit}>
      <input
        type="password"
        className="password-input"
        aria-label="Team password"
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
        <button type="button" className="password-cancel" onClick={() => useDeck.getState().cancelPasswordPrompt()}>
          Cancel
        </button>
        <button type="submit" className="password-submit" disabled={!password || verifying}>
          {verifying ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </Dialog>
  )
}

interface DialogProps {
  title: string
  children: ReactNode
  /** Makes the dialog a form. */
  onSubmit?: (event: FormEvent) => void
  /** Called for a click outside the dialog. Left out, it cancels the password prompt. */
  onDismiss?: () => void
  wide?: boolean
}

/** The modal card used by the password gate, conflicts and history. */
export function Dialog({ title, children, onSubmit, onDismiss, wide }: DialogProps) {
  const Card = onSubmit ? motion.form : motion.div
  const dismiss = onDismiss ?? (() => useDeck.getState().cancelPasswordPrompt())
  return (
    <motion.div
      className="password-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <Card
        className={wide ? 'password-modal dialog-wide' : 'password-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onSubmit={onSubmit}
      >
        <div className="password-header">
          <h2 className="password-title">{title}</h2>
        </div>
        {children}
      </Card>
    </motion.div>
  )
}
