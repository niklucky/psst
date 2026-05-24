import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { organisations } from './vaults';
import { vaults } from './vaults';

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  /** Optional — if set, the invite grants access to a specific vault too */
  vaultId: uuid('vault_id').references(() => vaults.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  /** owner | admin | member */
  role: text('role').notNull(),
  /** Random opaque token sent in the invite email */
  token: text('token').unique().notNull(),
  invitedBy: uuid('invited_by').references(() => users.id),
  expiresAt: timestamp('expires_at'),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
