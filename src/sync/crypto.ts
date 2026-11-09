/**
 * End-to-end encryption (AES-256-GCM via Web Crypto API) and PBKDF2 password verification.
 *
 * All presentation data is encrypted in the browser before being sent to Supabase, so the database
 * only stores opaque ciphertext, IV, and salt. Editing requires unlocking Input Mode with the team
 * password, which derives a cryptographic write token verified both client-side and server-side.
 */

export interface EncryptedEnvelope {
  ciphertext: string
  iv: string
  salt: string
}

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const IV_BYTES = 12

/** Default encryption key used when VITE_DECK_ENCRYPTION_KEY is not set. */
const DEFAULT_DECK_KEY = 'anxiety-presentation-e2ee-key-v1'

/** Default team edit password when VITE_EDIT_PASSWORD is not overridden in .env. */
export const DEFAULT_EDIT_PASSWORD = 'nursing2026'

const AUTH_SALT = 'anxiety-presentation-auth-salt-v1'
const TOKEN_SALT = 'anxiety-presentation-rpc-token-v1'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function deriveAesKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function deriveBitsHex(passphrase: string, saltString: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltString),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )
  return toHex(new Uint8Array(bits))
}

export function getDeckEncryptionKey(): string {
  const envKey = import.meta.env.VITE_DECK_ENCRYPTION_KEY as string | undefined
  return envKey?.trim() || DEFAULT_DECK_KEY
}

/**
 * Encrypts a JSON-serializable payload with AES-256-GCM using a random 16-byte salt and 12-byte IV.
 */
export async function encryptDeck<T>(payload: T, passphrase = getDeckEncryptionKey()): Promise<EncryptedEnvelope> {
  const saltBuffer = new ArrayBuffer(SALT_BYTES)
  const salt = new Uint8Array(saltBuffer)
  crypto.getRandomValues(salt)

  const ivBuffer = new ArrayBuffer(IV_BYTES)
  const iv = new Uint8Array(ivBuffer)
  crypto.getRandomValues(iv)

  const key = await deriveAesKey(passphrase, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    salt: toBase64(salt),
  }
}

/**
 * Decrypts an AES-256-GCM envelope back into its typed payload. Throws if tampered or wrong key.
 */
export async function decryptDeck<T>(envelope: EncryptedEnvelope, passphrase = getDeckEncryptionKey()): Promise<T> {
  const salt = fromBase64(envelope.salt)
  const iv = fromBase64(envelope.iv)
  const ciphertext = fromBase64(envelope.ciphertext)

  const key = await deriveAesKey(passphrase, salt)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  const json = new TextDecoder().decode(decrypted)
  return JSON.parse(json) as T
}

/**
 * Derives the server-side write token from the team password so the raw password is never sent.
 */
export async function deriveEditToken(password: string): Promise<string> {
  return deriveBitsHex(password.trim(), TOKEN_SALT)
}

/**
 * Derives a password verification hash for comparing against VITE_EDIT_PASSWORD_HASH.
 */
export async function derivePasswordVerifier(password: string): Promise<string> {
  return deriveBitsHex(password.trim(), AUTH_SALT)
}

/**
 * Verifies the user-entered password against VITE_EDIT_PASSWORD_HASH or VITE_EDIT_PASSWORD.
 */
export async function verifyEditPassword(candidate: string): Promise<{ valid: boolean; editToken: string | null }> {
  const trimmed = candidate.trim()
  if (!trimmed) return { valid: false, editToken: null }

  const configuredHash = (import.meta.env.VITE_EDIT_PASSWORD_HASH as string | undefined)?.trim()
  const configuredPlain = (import.meta.env.VITE_EDIT_PASSWORD as string | undefined)?.trim() || DEFAULT_EDIT_PASSWORD

  const candidateVerifier = await derivePasswordVerifier(trimmed)
  const expectedVerifier = configuredHash || (await derivePasswordVerifier(configuredPlain))

  if (candidateVerifier !== expectedVerifier) {
    return { valid: false, editToken: null }
  }

  const editToken = await deriveEditToken(trimmed)
  return { valid: true, editToken }
}
