// Reads firestore.rules with the editor UID swapped for another account's, so the rules tests and
// the local emulators can sign in as an editor of their own. The real UID stays in the file.
import { readFileSync } from 'node:fs'

const EDITOR_UID_LINE = /(function editorUid\(\) \{\s*return ')[^']*(';)/g

/** firestore.rules, with editorUid() returning `uid` in place of the real editor's UID. */
export function rulesWithEditor(uid) {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const matches = rules.match(EDITOR_UID_LINE) ?? []
  if (matches.length !== 1) {
    throw new Error(`firestore.rules should define editorUid() once, returning a quoted UID; found ${matches.length}.`)
  }
  return rules.replace(EDITOR_UID_LINE, `$1${uid}$2`)
}
