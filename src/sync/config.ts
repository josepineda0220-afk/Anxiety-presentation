/**
 * Cloud settings that need no Firebase code, so the main bundle can check them while the
 * Firebase SDK loads separately (see firebase.ts and cloudSync.ts).
 */

/**
 * The one shared Firebase Auth account the team signs in as. Its password is the team password.
 * Must match the email in firestore.rules, which only lets this account write the deck.
 */
export const EDITOR_EMAIL = 'editors@anxiety-presentation.invalid'

export const PRESENTATION_ID = (import.meta.env.VITE_PRESENTATION_ID as string | undefined)?.trim() || 'anxiety-deck'

export interface FirebaseWebConfig {
  apiKey: string
  authDomain?: string
  projectId: string
  appId: string
}

/** The VITE_FIREBASE_* settings, or null when they are missing and the app runs local-only. */
export function readFirebaseConfig(): FirebaseWebConfig | null {
  const env = import.meta.env
  const apiKey = (env.VITE_FIREBASE_API_KEY as string | undefined)?.trim()
  const authDomain = (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim()
  const projectId = (env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim()
  const appId = (env.VITE_FIREBASE_APP_ID as string | undefined)?.trim()
  if (!apiKey || !projectId || !appId) return null
  return { apiKey, authDomain: authDomain || undefined, projectId, appId }
}

export function isCloudConfigured(): boolean {
  return readFirebaseConfig() !== null
}
