import { useEffect, useState } from 'react'
import type { Conflict, ConflictChoice } from '../sync/engine'
import type { SavedVersion } from '../sync/firestoreTransport'
import type { BoxData, SectionData } from '../sync/schema'
import { useConflicts } from '../sync/syncStatus'
import { charFormats, segmentsOf } from './format'
import { Dialog } from './PasswordGate'

const cloud = () => import('../sync/cloudSync')

/** A box's sizes and colours in words, to tell apart two versions that say the same thing. */
function formatsOf(box: BoxData) {
  return segmentsOf(box.text, charFormats(box))
    .filter((segment) => segment.text.trim())
    .map((segment) => `${segment.style}, ${segment.color}: “${segment.text.trim().slice(0, 40)}”`)
    .join('\n')
}

function describe(conflict: Conflict): { what: string; mine: string; theirs: string } {
  const show = (data: Conflict['mine']) => {
    if (data === null) return '(removed)'
    if (conflict.kind === 'box') {
      const box = data as BoxData
      const sameWords = (conflict.mine as BoxData | null)?.text === (conflict.theirs as BoxData | null)?.text
      return sameWords && box.text ? formatsOf(box) : box.text || '(empty)'
    }
    const section = data as SectionData
    return `${section.title}\n${section.slides.length} slide${section.slides.length === 1 ? '' : 's'}: ${section.slides.map((s) => s.title).join(', ')}`
  }
  const what = conflict.kind === 'box' ? 'text box' : 'section'
  return { what, mine: show(conflict.mine), theirs: show(conflict.theirs) }
}

/**
 * Shown when someone else saved the same section or text box, in a way that cannot be combined
 * with this device's change. Nothing is saved over theirs until the person chooses.
 */
export function ConflictPrompt() {
  const conflicts = useConflicts()
  const conflict = conflicts[0]
  if (!conflict) return null
  const { what, mine, theirs } = describe(conflict)
  const removedHere = conflict.mine === null
  const removedThere = conflict.theirs === null
  const lead = removedThere
    ? `Someone else removed this ${what} while you were changing it.`
    : removedHere
      ? `Someone else changed this ${what} after you removed it.`
      : `Someone else changed this ${what} while you were editing it.`
  const choose = (choice: ConflictChoice) => void cloud().then((m) => m.resolveConflict(conflict.key, choice))

  return (
    <Dialog title="Two versions" wide onDismiss={() => {}}>
      <p className="password-desc">
        {lead} Nothing has been saved over their version. Which should the deck keep?
        {conflicts.length > 1 && ` (${conflicts.length - 1} more after this.)`}
      </p>
      <div className="conflict-versions">
        <section className="conflict-version">
          <h3>Their version</h3>
          <p>{theirs}</p>
        </section>
        <section className="conflict-version">
          <h3>Your version</h3>
          <p>{mine}</p>
        </section>
      </div>
      <div className="password-actions">
        <button type="button" className="password-cancel" onClick={() => choose('theirs')} title="Use their version and drop your change">
          Reload theirs
        </button>
        <button type="button" className="password-cancel" onClick={() => choose('mine')} title="Save your version on top of theirs">
          Keep mine
        </button>
        <button
          type="button"
          className="password-submit"
          onClick={() => choose('merge')}
          title="Keep both: their text, then yours, plus every change that does not clash"
        >
          Merge both
        </button>
      </div>
    </Dialog>
  )
}

const when = (date: Date | null) =>
  date ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Saving…'

/** The saved versions of the deck, newest first, any of which can be brought back. */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const [versions, setVersions] = useState<SavedVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<SavedVersion | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let live = true
    cloud()
      .then((m) => m.listVersions())
      .then((list) => live && setVersions(list))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'Couldn’t load the history.'))
    return () => {
      live = false
    }
  }, [])

  const restore = async (version: SavedVersion) => {
    if (!version.snapshot) return
    setRestoring(true)
    setError(null)
    try {
      await (await cloud()).restoreVersion(version.snapshot)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t restore that version.')
      setRestoring(false)
    }
  }

  if (confirming) {
    return (
      <Dialog title="Restore this version?" onDismiss={() => setConfirming(null)}>
        <p className="password-desc">
          The deck will go back to how it was on {when(confirming.savedAt)}, for everyone. This is saved as a new
          change, so the history keeps today’s version too. Edits from the last few minutes may not have a saved
          version yet.
        </p>
        {error && (
          <p className="password-error" role="alert">
            {error}
          </p>
        )}
        <div className="password-actions">
          <button type="button" className="password-cancel" disabled={restoring} onClick={() => setConfirming(null)}>
            Back
          </button>
          <button type="button" className="password-submit" disabled={restoring} onClick={() => void restore(confirming)}>
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title="Version history" wide onDismiss={onClose}>
      <p className="password-desc">A version is saved about every 5 minutes while people edit.</p>
      {error && (
        <p className="password-error" role="alert">
          {error}
        </p>
      )}
      {versions === null && !error && <p className="password-desc">Loading…</p>}
      {versions?.length === 0 && <p className="password-desc">No versions yet. The first one is saved after 5 minutes of editing.</p>}
      {versions && versions.length > 0 && (
        <ul className="history-list">
          {versions.map((version) => (
            <li key={version.seq}>
              <span>
                {when(version.savedAt)}
                <span className="history-meta">
                  Version {version.seq} · {version.sectionCount} sections · {version.boxCount} text boxes
                </span>
              </span>
              <button type="button" className="password-cancel" disabled={!version.snapshot} onClick={() => setConfirming(version)}>
                Restore…
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="password-actions">
        <button type="button" className="password-submit" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}
