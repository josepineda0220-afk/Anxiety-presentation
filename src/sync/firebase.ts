import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check'
import {
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth'
import { connectFirestoreEmulator, initializeFirestore, type Firestore } from 'firebase/firestore'
import { USE_EMULATORS, appCheckSiteKey, editorEmail, readFirebaseConfig } from './config'

declare global {
  // Read by App Check: `true` prints a debug token to the console; a string uses that token.
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined
}

interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

let handles: FirebaseHandles | null | undefined

/**
 * The Firebase app, auth and database (this module is loaded on demand), or null when the
 * VITE_FIREBASE_* settings are missing.
 */
export function getFirebase(): FirebaseHandles | null {
  if (handles !== undefined) return handles
  const config = readFirebaseConfig()
  if (!config) return (handles = null)
  const app = getApps().length ? getApp() : initializeApp(config)

  // App Check comes first, so every Firestore and Auth request carries its token. The emulators
  // do not check tokens, so it stays off there.
  const siteKey = appCheckSiteKey()
  if (siteKey && !USE_EMULATORS) {
    // Local development: register the token App Check prints (or VITE_APPCHECK_DEBUG_TOKEN) in the
    // Firebase console. Production builds drop this branch entirely.
    if (import.meta.env.DEV) {
      globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined)?.trim() || true
    }
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })
  }

  // Signing in lasts until this tab closes (it survives a reload of the tab, not a new tab).
  const auth = initializeAuth(app, { persistence: browserSessionPersistence })
  const db = initializeFirestore(app, {})
  if (USE_EMULATORS) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  handles = { app, auth, db }
  return handles
}

export type SignInResult = 'ok' | 'wrong' | 'rate-limited' | 'offline' | 'unavailable'

/** The sign-in errors that mean "that password didn't work". They all get the same message. */
const CREDENTIAL_ERRORS = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/user-disabled',
  'auth/missing-password',
  'auth/invalid-email',
])

/** Signs in as the shared editor account with the team password. */
export async function signInEditor(password: string): Promise<SignInResult> {
  const firebase = getFirebase()
  const email = editorEmail()
  if (!firebase || !email) return 'unavailable'
  try {
    await signInWithEmailAndPassword(firebase.auth, email, password)
    return 'ok'
  } catch (error) {
    const code = (error as { code?: string }).code ?? ''
    if (code === 'auth/too-many-requests') return 'rate-limited'
    if (code === 'auth/network-request-failed') return 'offline'
    // Anything else is set-up trouble (worth a note for whoever runs the deck), but the person
    // signing in sees the same message as for a wrong password.
    if (!CREDENTIAL_ERRORS.has(code)) console.warn('Sign-in failed:', code || error)
    return 'wrong'
  }
}

export async function signOutEditor(): Promise<void> {
  const firebase = getFirebase()
  if (firebase?.auth.currentUser) await signOut(firebase.auth)
}

/** Calls back with whether the editor account is signed in on this tab, now and on every change. */
export function watchEditor(onChange: (signedIn: boolean) => void): () => void {
  const firebase = getFirebase()
  const email = editorEmail()
  if (!firebase || !email) {
    onChange(false)
    return () => {}
  }
  return onAuthStateChanged(firebase.auth, (user) => onChange(user?.email?.toLowerCase() === email.toLowerCase()))
}

export function currentUid(): string | null {
  return getFirebase()?.auth.currentUser?.uid ?? null
}
