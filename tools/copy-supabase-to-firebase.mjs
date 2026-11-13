// One-off: copies the encrypted deck from Supabase into Firestore, unchanged.
// The envelope is copied as-is, so it still decrypts with the same VITE_DECK_ENCRYPTION_KEY.
// Usage: read -s "PW?Team password: "; echo; PW="$PW" node --env-file=.env tools/copy-supabase-to-firebase.mjs; unset PW
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getFirestore, serverTimestamp, setDoc, terminate } from 'firebase/firestore'

// Must match EDITOR_EMAIL in src/sync/firebase.ts and firestore.rules.
const EDITOR_EMAIL = 'editors@anxiety-presentation.invalid'

const env = process.env
const deckId = env.VITE_PRESENTATION_ID?.trim() || 'anxiety-deck'
const password = env.PW?.trim()
const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'].filter(
  (key) => !env[key]?.trim(),
)
if (missing.length || !password) {
  console.error(`Missing: ${[...missing, ...(password ? [] : ['PW'])].join(', ')}`)
  process.exit(1)
}

const url = `${env.VITE_SUPABASE_URL.trim()}/rest/v1/presentations?id=eq.${encodeURIComponent(deckId)}&select=ciphertext,iv,salt,updated_at`
const key = env.VITE_SUPABASE_ANON_KEY.trim()
const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
if (!response.ok) {
  console.error(`Supabase read failed: ${response.status} ${await response.text()}`)
  process.exit(1)
}
const [row] = await response.json()
if (!row) {
  console.error(`No deck "${deckId}" in Supabase. Nothing to copy.`)
  process.exit(1)
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY.trim(),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: env.VITE_FIREBASE_PROJECT_ID.trim(),
  appId: env.VITE_FIREBASE_APP_ID.trim(),
})
await signInWithEmailAndPassword(getAuth(app), EDITOR_EMAIL, password)
const db = getFirestore(app)
await setDoc(doc(db, 'presentations', deckId), {
  ciphertext: row.ciphertext,
  iv: row.iv,
  salt: row.salt,
  updatedAt: serverTimestamp(),
})
await terminate(db)
console.log(`Copied "${deckId}" (last saved in Supabase ${row.updated_at}) to Firestore project ${env.VITE_FIREBASE_PROJECT_ID.trim()}.`)
process.exit(0)
