import { describe, expect, it, vi } from 'vitest'

// Check against the built-in default password, whatever the local .env sets.
vi.stubEnv('VITE_EDIT_PASSWORD_HASH', '')
vi.stubEnv('VITE_EDIT_PASSWORD', '')
import { DEFAULT_EDIT_PASSWORD, decryptDeck, encryptDeck, verifyEditPassword } from './crypto'

describe('AES-256-GCM end-to-end encryption', () => {
  it('encrypts and decrypts deck state with a random IV and salt each time', async () => {
    const sample = {
      sections: [{ id: 'sec-1', title: 'Outline', backdrop: 'purple', slides: [] }],
      boxes: [{ id: 'b1', slide: '1-1', text: 'Confidential notes', x: 0.1, y: 0.2 }],
    }

    const first = await encryptDeck(sample, 'secret-passphrase')
    const second = await encryptDeck(sample, 'secret-passphrase')

    // Ciphertext, IV, and salt are never plaintext and differ on every encryption call.
    expect(first.ciphertext).not.toContain('Confidential')
    expect(first.iv).not.toBe(second.iv)
    expect(first.salt).not.toBe(second.salt)
    expect(first.ciphertext).not.toBe(second.ciphertext)

    const decrypted = await decryptDeck<typeof sample>(first, 'secret-passphrase')
    expect(decrypted).toEqual(sample)
  })

  it('rejects decryption when the key is wrong or ciphertext is tampered with', async () => {
    const envelope = await encryptDeck({ hello: 'world' }, 'correct-key')
    await expect(decryptDeck(envelope, 'wrong-key')).rejects.toThrow()

    const tampered = {
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA',
    }
    await expect(decryptDeck(tampered, 'correct-key')).rejects.toThrow()
  })
})

describe('PBKDF2 password gate verification', () => {
  it('accepts the configured team password', async () => {
    expect(await verifyEditPassword(DEFAULT_EDIT_PASSWORD)).toBe(true)
  })

  it('rejects an incorrect or blank password', async () => {
    expect(await verifyEditPassword('wrong-password')).toBe(false)
    expect(await verifyEditPassword('   ')).toBe(false)
  })
})
