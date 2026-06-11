import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * WebAuthn (passkey) credentials — used for auth-only login (stage 5). A passkey
 * replaces the password step for *creating a session*; it never touches the
 * encryption keys, so a successful passkey login still lands on `/unlock` and
 * the master password is required to derive the vault key.
 */
export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** base64url-encoded credential ID returned by the authenticator (unique per credential) */
  credentialId: text('credential_id').unique().notNull(),
  /** base64url-encoded COSE public key */
  publicKey: text('public_key').notNull(),
  /** signature counter — must be non-decreasing to detect cloned authenticators */
  counter: integer('counter').default(0).notNull(),
  /** JSON array of transports (e.g. ["internal","hybrid"]) hint for the browser */
  transports: text('transports'),
  /** "singleDevice" | "multiDevice" */
  deviceType: text('device_type'),
  /** whether the credential is backed up / synced (e.g. iCloud Keychain) */
  backedUp: boolean('backed_up').default(false).notNull(),
  /** user-facing label, e.g. "MacBook Touch ID" */
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at'),
});

/**
 * Short-lived WebAuthn ceremony challenges. Stored server-side between the
 * `…Options` and `…Verify` steps so the assertion/attestation can be checked
 * against the exact challenge we issued. `userId` is null for discoverable
 * (usernameless) login, where the user isn't known until the assertion resolves.
 */
export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type NewWebauthnCredential = typeof webauthnCredentials.$inferInsert;
export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect;
export type NewWebauthnChallenge = typeof webauthnChallenges.$inferInsert;
