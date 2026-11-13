import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { inMemoryPersistence, initializeAuth, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { EDITOR_EMAIL, readFirebaseConfig } from './config'

interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

let handles: FirebaseHandles | null | undefined

/** The Firebase app, auth and database (this module is loaded on demand), or null when the VITE_FIREBASE_* settings are missing. */
export function getFirebase(): FirebaseHandles | null {
  if (handles !== undefined) return handles
  const config = readFirebaseConfig()
  if (!config) return (handles = null)
  const app = getApps().length ? getApp() : initializeApp(config)
  // Sign-in lasts until the tab closes or Input Mode is locked, matching the unlocked flag in the deck store.
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  handles = { app, auth, db: getFirestore(app) }
  return handles
}

export function isEditorSignedIn(): boolean {
  return getFirebase()?.auth.currentUser?.email === EDITOR_EMAIL
}

/** Signs in as the shared editor account. False for a wrong password; throws for network and setup errors. */
export async function signInEditor(password: string): Promise<boolean> {
  const firebase = getFirebase()
  if (!firebase) return false
  try {
    await signInWithEmailAndPassword(firebase.auth, EDITOR_EMAIL, password)
    return true
  } catch (err) {
    const code = (err as { code?: string }).code ?? ''
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-login-credentials' ||
      code === 'auth/missing-password'
    ) {
      return false
    }
    throw err
  }
}

export async function signOutEditor(): Promise<void> {
  const firebase = getFirebase()
  if (firebase?.auth.currentUser) await signOut(firebase.auth)
}
