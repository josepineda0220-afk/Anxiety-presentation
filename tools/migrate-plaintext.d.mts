// Types for tools/migrate-plaintext.mjs, for the tests that import it.
import type { FieldValue as AdminFieldValue, Firestore as AdminFirestore } from 'firebase-admin/firestore'

export declare const SCHEMA_VERSION: 2

export interface LegacyEnvelope {
  ciphertext: string
  iv: string
  salt: string
}

export declare function decryptEnvelope(envelope: LegacyEnvelope, passphrase: string): Promise<unknown>

export interface BuiltDeck {
  sectionOrder: string[]
  sectionDocs: Record<string, Record<string, unknown>>
  boxIds: string[]
  boxDocs: Record<string, Record<string, unknown>>
  snapshotJson: string
  skipped: string[]
  orphans: string[]
  problems: string[]
}

export declare function buildDeck(payload: unknown): BuiltDeck

export interface MigrateOptions {
  db: AdminFirestore
  FieldValue: typeof AdminFieldValue
  deckId: string
  key: string
  dryRun: boolean
  backupDir: string
  log?: (line: string) => void
  now?: Date
}

export declare function migrate(options: MigrateOptions): Promise<{
  status: 'already-migrated' | 'problems' | 'dry-run' | 'migrated'
  deck?: BuiltDeck
  backupFile?: string
  backupId?: string
}>
