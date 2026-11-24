// Runs the deck against local Firebase emulators, so editing can be tried without touching the real
// project. Usage: npm run emulators, then in another terminal: npm run dev:emulators
//
// It copies firestore.rules with the editor UID placeholder set to a local account, starts the
// Auth and Firestore emulators with that copy, and creates the editor account in the Auth emulator.
// The team password for this local account is "local-password". Nothing here reaches a real project:
// the project id starts with "demo-", which the Firebase CLI keeps fully offline.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rulesWithEditor } from './rules-source.mjs'

export const PROJECT_ID = 'demo-anxiety-deck'
export const LOCAL_EDITOR = {
  uid: 'local-editor',
  email: 'editors@anxiety-presentation.invalid',
  password: 'local-password',
}

const root = fileURLToPath(new URL('..', import.meta.url))
const workDir = join(root, '.firebase', 'emulators')
mkdirSync(workDir, { recursive: true })

writeFileSync(join(workDir, 'firestore.rules'), rulesWithEditor(LOCAL_EDITOR.uid))
writeFileSync(
  join(workDir, 'firebase.json'),
  JSON.stringify(
    {
      firestore: { rules: 'firestore.rules' },
      emulators: {
        auth: { host: '127.0.0.1', port: 9099 },
        firestore: { host: '127.0.0.1', port: 8080 },
        ui: { enabled: false },
        singleProjectMode: true,
      },
    },
    null,
    2,
  ),
)

const firebase = spawn('npx', ['firebase', 'emulators:start', '--config', join(workDir, 'firebase.json'), '--project', PROJECT_ID], {
  cwd: workDir,
  stdio: 'inherit',
})
firebase.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => firebase.kill(signal))

// Once the Auth emulator answers, add the editor account with a fixed UID.
const accounts = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`
for (let attempt = 0; attempt < 60; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  try {
    const response = await fetch(accounts, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: LOCAL_EDITOR.uid, email: LOCAL_EDITOR.email, password: LOCAL_EDITOR.password }),
    })
    if (response.ok || (await response.text()).includes('DUPLICATE')) {
      console.log(`\n  Local editor ready: ${LOCAL_EDITOR.email}, team password "${LOCAL_EDITOR.password}".\n`)
      break
    }
  } catch {
    // Not up yet.
  }
}
