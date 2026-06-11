import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  /** Used to decide whether a login is "stale" and needs step-up verification */
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Stores all cryptographic material derived from the user's password.
 * The server never sees plaintext passwords — only the argon2id auth hash.
 *
 * Key hierarchy:
 *   password → argon2id(password, argon2Salt) → masterKey (client-side only)
 *   masterKey → AES-GCM decrypt → vaultKey  (server stores ciphertext)
 *   masterKey → AES-GCM decrypt → privateKey (server stores ciphertext)
 */
export const userCredentials = pgTable('user_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** argon2id(password, argon2Salt) — used to verify login. Server never sees plaintext. */
  authHash: text('auth_hash').notNull(),
  /** base64-encoded 16-byte salt used for argon2id key derivation (client-side) */
  argon2Salt: text('argon2_salt').notNull(),
  /** base64 AES-256-GCM ciphertext of the user's vault key */
  encryptedVaultKey: text('encrypted_vault_key').notNull(),
  /** base64 12-byte nonce for encryptedVaultKey */
  vaultKeyIv: text('vault_key_iv').notNull(),
  /** base64 X25519 public key — shared with other users for vault sharing */
  publicKey: text('public_key').notNull(),
  /** base64 AES-256-GCM ciphertext of the user's X25519 private key */
  encryptedPrivateKey: text('encrypted_private_key').notNull(),
  /** base64 12-byte nonce for encryptedPrivateKey */
  privateKeyIv: text('private_key_iv').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** sha256 hex of the opaque session token sent to the client */
  tokenHash: text('token_hash').unique().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
});

// ---- TypeScript types inferred from schema ----
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserCredentials = typeof userCredentials.$inferSelect;
export type NewUserCredentials = typeof userCredentials.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
