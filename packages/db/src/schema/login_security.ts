import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Devices (identified by a hash of IP + User-Agent) a user has previously
 * completed a step-up challenge from. Logins from a known device skip the
 * step-up email code.
 */
export const knownDevices = pgTable(
  'known_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 hex of `${ipAddress}|${userAgent}` */
    fingerprintHash: text('fingerprint_hash').notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.fingerprintHash)],
);

/**
 * Represents "primary factor passed, session not yet issued" — used for
 * step-up email verification (and, later, TOTP/2FA).
 */
export const pendingAuthentications = pgTable('pending_authentications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** email_code | totp (future) */
  kind: text('kind').notNull(),
  /** sha256 hex of the one-time code */
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type KnownDevice = typeof knownDevices.$inferSelect;
export type NewKnownDevice = typeof knownDevices.$inferInsert;
export type PendingAuthentication = typeof pendingAuthentications.$inferSelect;
export type NewPendingAuthentication = typeof pendingAuthentications.$inferInsert;
