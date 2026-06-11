import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * TOTP (authenticator app) credentials. The secret must be readable by the
 * server to verify codes, so it's encrypted at rest with a server-side key
 * (derived from SESSION_SECRET) — unlike vault data, which the server never
 * needs to decrypt.
 */
export const totpCredentials = pgTable('totp_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  /** AES-256-GCM ciphertext of the base32 TOTP secret, format `iv:ciphertext` (both hex) */
  encryptedSecret: text('encrypted_secret').notNull(),
  enabled: timestamp('enabled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Single-use backup codes for accounts with TOTP enabled, usable instead of
 * a TOTP code if the authenticator device is unavailable.
 */
export const backupCodes = pgTable('backup_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** sha256 hex of the backup code */
  codeHash: text('code_hash').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type TotpCredential = typeof totpCredentials.$inferSelect;
export type NewTotpCredential = typeof totpCredentials.$inferInsert;
export type BackupCode = typeof backupCodes.$inferSelect;
export type NewBackupCode = typeof backupCodes.$inferInsert;
