import { pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { vaults } from './vaults';

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'cascade' }),
  /** Nullable — null means root level */
  parentId: uuid('parent_id'),
  /** Folder names are metadata, not secrets — stored plaintext */
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Self-referential FK on folders.parent_id — added after table definition
// to avoid circular reference at declaration time.
// The FK is expressed in the migration directly.

export const secrets = pgTable('secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  /** login | note | file | env_var | card */
  type: text('type').notNull(),
  /** Plaintext label — e.g. "GitHub token". Not sensitive. */
  name: text('name').notNull(),
  /** base64 AES-256-GCM ciphertext of the JSON payload (decrypted client-side) */
  ciphertext: text('ciphertext').notNull(),
  /** base64 12-byte nonce */
  iv: text('iv').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: text('colour'),
  },
  (t) => [unique().on(t.vaultId, t.name)],
);

export const secretTags = pgTable(
  'secret_tags',
  {
    secretId: uuid('secret_id')
      .notNull()
      .references(() => secrets.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.secretId, t.tagId] })],
);

export const secretVersions = pgTable('secret_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  secretId: uuid('secret_id')
    .notNull()
    .references(() => secrets.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- TypeScript types ----
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type SecretTag = typeof secretTags.$inferSelect;
export type SecretVersion = typeof secretVersions.$inferSelect;
export type NewSecretVersion = typeof secretVersions.$inferInsert;
