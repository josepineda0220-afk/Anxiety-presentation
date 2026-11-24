/**
 * Encrypts a deck the way the app did before this change (src/sync/crypto.ts, now removed):
 * PBKDF2-SHA-256 with 100,000 iterations and a random 16-byte salt, then AES-256-GCM with a random
 * 12-byte IV, everything base64. Tests use it to make realistic old documents to migrate.
 */
export async function encryptLikeTheOldApp(payload: unknown, passphrase: string) {
  const { subtle } = globalThis.crypto
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)))
  const base64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64')
  return { ciphertext: base64(ciphertext), iv: base64(iv), salt: base64(salt) }
}
