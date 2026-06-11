import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Vault recovery key — the "forgot my master password" escape hatch.
 *
 * The user's master key is wrapped under a key derived from a high-entropy
 * recovery code: `recoveryKey = argon2id(recoveryCode, recoverySalt)`, then
 * `wrappedMasterKey = AES-GCM(masterKey, recoveryKey)`. The server stores only
 * the ciphertext + salts and never sees the recovery code or the master key —
 * the same trust boundary as password login.
 *
 * Recovering the master key transitively restores everything wrapped under it:
 * the personal vault key, the X25519 private key, and every shared
 * `vaultMembers.encryptedVaultKey` — no per-vault work needed.
 *
 * `recoveryAuthHash` is a separate server-verifiable proof of the recovery code
 * (argon2id with `recoveryAuthSalt`), mirroring `userCredentials.authHash`. It
 * gates `completeRecovery` so an attacker who only knows an email can't overwrite
 * a victim's credentials.
 */
export const recoveryKeys = pgTable('recovery_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  /** base64 16-byte salt for deriving the wrap key from the recovery code */
  recoverySalt: text('recovery_salt').notNull(),
  /** base64 16-byte salt for deriving the server-verifiable recovery auth hash */
  recoveryAuthSalt: text('recovery_auth_salt').notNull(),
  /** base64 argon2id("recovery-auth:" + recoveryCode, recoveryAuthSalt) */
  recoveryAuthHash: text('recovery_auth_hash').notNull(),
  /** base64 AES-256-GCM ciphertext of the master key */
  wrappedMasterKey: text('wrapped_master_key').notNull(),
  /** base64 12-byte nonce for wrappedMasterKey */
  recoveryKeyIv: text('recovery_key_iv').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type RecoveryKey = typeof recoveryKeys.$inferSelect;
export type NewRecoveryKey = typeof recoveryKeys.$inferInsert;
