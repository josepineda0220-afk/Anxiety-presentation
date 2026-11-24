/**
 * Cloud settings from the VITE_* build variables. Nothing here imports Firebase, so the main bundle
 * can check them while the Firebase SDK loads separately (see firebase.ts and cloudSync.ts).
 *
 * Every value here is public: it ends up in the browser. Who may write is decided by
 * firestore.rules, which only accept the shared editor account's UID.
 */

const env = (name: string): string | undefined => (import.meta.env[name] as string | undefined)?.trim() || undefined

export const PRESENTATION_ID = env('VITE_PRESENTATION_ID') ?? 'anxiety-deck'

/** True to use the local Firebase emulators (npm run emulators) instead of a real project. */
export const USE_EMULATORS = env('VITE_USE_EMULATORS') === 'true'

export interface FirebaseWebConfig {
  apiKey: string
  authDomain?: string
  projectId: string
  appId: string
}

/** The VITE_FIREBASE_* settings, or null when they are missing and the deck is view-only. */
export function readFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = env('VITE_FIREBASE_API_KEY')
  const projectId = env('VITE_FIREBASE_PROJECT_ID')
  const appId = env('VITE_FIREBASE_APP_ID')
  if (!apiKey || !projectId || !appId) return null
  return { apiKey, authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'), projectId, appId }
}

/**
 * The one shared Firebase Auth account the team signs in as. Its password is the team password,
 * and firestore.rules only let this account's UID write.
 */
export function editorEmail(): string | null {
  return env('VITE_EDITOR_EMAIL') ?? null
}

/** The reCAPTCHA Enterprise site key for App Check. Site keys are public by design. */
export function appCheckSiteKey(): string | null {
  return env('VITE_APPCHECK_SITE_KEY') ?? null
}

export function isCloudConfigured(): boolean {
  return readFirebaseConfig() !== null
}

/** Whether this build can sign in to edit at all. */
export function isEditingConfigured(): boolean {
  return isCloudConfigured() && editorEmail() !== null
}
