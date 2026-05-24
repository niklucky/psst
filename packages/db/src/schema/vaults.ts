import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const organisationMembers = pgTable(
  'organisation_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** owner | admin | member */
    role: text('role').notNull().default('member'),
    invitedBy: uuid('invited_by').references(() => users.id),
    joinedAt: timestamp('joined_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.organisationId, t.userId)],
);

export const vaults = pgTable('vaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const vaultMembers = pgTable(
  'vault_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** owner | editor | viewer */
    role: text('role').notNull().default('viewer'),
    /**
     * Vault key re-encrypted for this specific member.
     * For 'active' members: AES-256-GCM with their master key.
     * For 'pending' invites: AES-256-GCM with ECDH shared secret derived from senderPublicKey.
     */
    encryptedVaultKey: text('encrypted_vault_key').notNull(),
    vaultKeyIv: text('vault_key_iv').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
    /**
     * 'pending' = vault key is ECDH-encrypted, user hasn't accepted yet.
     * 'active'  = vault key is master-key-wrapped, user has access.
     */
    inviteStatus: text('invite_status').notNull().default('active'),
    /**
     * X25519 public key (base64) of the user who created the invite.
     * Only set for 'pending' rows; null for 'active' members.
     */
    senderPublicKey: text('sender_public_key'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.vaultId, t.userId)],
);

// ---- TypeScript types ----
export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type OrganisationMember = typeof organisationMembers.$inferSelect;
export type NewOrganisationMember = typeof organisationMembers.$inferInsert;
export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
export type VaultMember = typeof vaultMembers.$inferSelect;
export type NewVaultMember = typeof vaultMembers.$inferInsert;
