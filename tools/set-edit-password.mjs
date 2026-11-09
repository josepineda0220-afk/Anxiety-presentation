// Usage: read -s "PW?New team password: "; echo; PW="$PW" node tools/set-edit-password.mjs; unset PW
import { readFileSync, writeFileSync } from 'node:fs'
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const password = process.env.PW?.trim()
if (!password) {
  console.error('No password provided. Set PW in the environment.')
  process.exit(1)
}

// Must match AUTH_SALT and PBKDF2_ITERATIONS in src/sync/crypto.ts
const hash = pbkdf2Sync(password, 'anxiety-presentation-auth-salt-v1', 100_000, 32, 'sha256').toString('hex')

let env = readFileSync('.env', 'utf8')
env = env.replace(/^VITE_EDIT_PASSWORD_HASH=.*\n?/m, '')
env = /^VITE_EDIT_PASSWORD=.*$/m.test(env)
  ? env.replace(/^VITE_EDIT_PASSWORD=.*$/m, `VITE_EDIT_PASSWORD_HASH=${hash}`)
  : `${env.trimEnd()}\nVITE_EDIT_PASSWORD_HASH=${hash}\n`

if (/^VITE_DECK_ENCRYPTION_KEY=anxiety-presentation-e2ee-key-v1\s*$/m.test(env)) {
  env = env.replace(/^VITE_DECK_ENCRYPTION_KEY=.*$/m, `VITE_DECK_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
}

writeFileSync('.env', env)
console.log('Updated .env')
