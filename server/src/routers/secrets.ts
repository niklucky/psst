import { db, folders, secretTags, secretVersions, secrets, tags, vaultMembers, vaults } from '@psst/db';
import { SECRET_TYPES } from '@psst/shared';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { protectedProcedure, router } from '../trpc';

/** Verify vault access and return the membership row. */
async function requireVaultAccess(
  vaultId: string,
  userId: string,
  allowedRoles: string[] = ['owner', 'editor', 'viewer'],
) {
  const [membership] = await db
    .select({ role: vaultMembers.role })
    .from(vaultMembers)
    .where(and(eq(vaultMembers.vaultId, vaultId), eq(vaultMembers.userId, userId)))
    .limit(1);

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return membership;
}

/** Verify the caller can access the secret's vault and return the secret row. */
async function requireSecretAccess(
  secretId: string,
  userId: string,
  allowedRoles: string[] = ['owner', 'editor', 'viewer'],
) {
  const [row] = await db
    .select({
      id: secrets.id,
      vaultId: secrets.vaultId,
      role: vaultMembers.role,
    })
    .from(secrets)
    .innerJoin(vaultMembers, and(
      eq(vaultMembers.vaultId, secrets.vaultId),
      eq(vaultMembers.userId, userId),
    ))
    .where(eq(secrets.id, secretId))
    .limit(1);

  if (!row || !allowedRoles.includes(row.role)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return row;
}

export const secretsRouter = router({
  /**
   * Lists secret metadata for a vault. Never returns ciphertext.
   * Supports filtering by folder, type, and name search.
   */
  list: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        folderId: z.string().uuid().optional(),
        type: z.enum(SECRET_TYPES).optional(),
        search: z.string().max(200).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId);

      const conditions = [eq(secrets.vaultId, input.vaultId)];
      if (input.folderId) conditions.push(eq(secrets.folderId, input.folderId));
      if (input.type) conditions.push(eq(secrets.type, input.type));
      if (input.search) conditions.push(ilike(secrets.name, `%${input.search}%`));

      const rows = await db
        .select({
          id: secrets.id,
          name: secrets.name,
          type: secrets.type,
          folderId: secrets.folderId,
          createdAt: secrets.createdAt,
          updatedAt: secrets.updatedAt,
        })
        .from(secrets)
        .where(and(...conditions))
        .orderBy(desc(secrets.updatedAt));

      // Attach tag IDs for each secret
      const secretIds = rows.map((r) => r.id);
      const tagRows =
        secretIds.length > 0
          ? await db
              .select({ secretId: secretTags.secretId, tagId: secretTags.tagId })
              .from(secretTags)
              .where(inArray(secretTags.secretId, secretIds))
          : [];

      const tagMap = new Map<string, string[]>();
      for (const { secretId, tagId } of tagRows) {
        const arr = tagMap.get(secretId) ?? [];
        arr.push(tagId);
        tagMap.set(secretId, arr);
      }

      return rows.map((r) => ({ ...r, tagIds: tagMap.get(r.id) ?? [] }));
    }),

  /**
   * Returns a single secret including its ciphertext and IV.
   * The client decrypts with the vault key already in memory.
   */
  get: protectedProcedure
    .input(z.object({ secretId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireSecretAccess(input.secretId, ctx.session.userId);

      const [row] = await db
        .select()
        .from(secrets)
        .where(eq(secrets.id, input.secretId))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      const tagRows = await db
        .select({ tagId: secretTags.tagId })
        .from(secretTags)
        .where(eq(secretTags.secretId, input.secretId));

      return { ...row, tagIds: tagRows.map((t) => t.tagId) };
    }),

  /** Creates a new secret and records the initial version. */
  create: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        folderId: z.string().uuid().optional(),
        type: z.enum(SECRET_TYPES),
        name: z.string().min(1).max(200),
        ciphertext: z.string().min(1),
        iv: z.string().min(1),
        tagIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner', 'editor']);

      const result = await db.transaction(async (tx) => {
        const [secret] = await tx
          .insert(secrets)
          .values({
            vaultId: input.vaultId,
            folderId: input.folderId ?? null,
            type: input.type,
            name: input.name,
            ciphertext: input.ciphertext,
            iv: input.iv,
            createdBy: ctx.session.userId,
          })
          .returning();

        if (!secret) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        // Record initial version
        await tx.insert(secretVersions).values({
          secretId: secret.id,
          ciphertext: input.ciphertext,
          iv: input.iv,
          createdBy: ctx.session.userId,
        });

        // Attach tags
        if (input.tagIds?.length) {
          await tx
            .insert(secretTags)
            .values(input.tagIds.map((tagId) => ({ secretId: secret.id, tagId })));
        }

        return secret;
      });

      return result;
    }),

  /** Updates a secret. Appends a version entry if ciphertext changes. */
  update: protectedProcedure
    .input(
      z.object({
        secretId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        ciphertext: z.string().min(1).optional(),
        iv: z.string().min(1).optional(),
        tagIds: z.array(z.string().uuid()).optional(),
        folderId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await requireSecretAccess(input.secretId, ctx.session.userId, [
        'owner',
        'editor',
      ]);

      await db.transaction(async (tx) => {
        const updates: Partial<typeof secrets.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.name) updates.name = input.name;
        if (input.ciphertext) updates.ciphertext = input.ciphertext;
        if (input.iv) updates.iv = input.iv;
        if (input.folderId !== undefined) updates.folderId = input.folderId;

        await tx.update(secrets).set(updates).where(eq(secrets.id, input.secretId));

        if (input.ciphertext && input.iv) {
          await tx.insert(secretVersions).values({
            secretId: input.secretId,
            ciphertext: input.ciphertext,
            iv: input.iv,
            createdBy: ctx.session.userId,
          });
        }

        if (input.tagIds !== undefined) {
          await tx.delete(secretTags).where(eq(secretTags.secretId, input.secretId));
          if (input.tagIds.length) {
            await tx
              .insert(secretTags)
              .values(input.tagIds.map((tagId) => ({ secretId: input.secretId, tagId })));
          }
        }
      });

      return { ok: true };
    }),

  /** Deletes a secret (cascades versions and tag links). */
  delete: protectedProcedure
    .input(z.object({ secretId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireSecretAccess(input.secretId, ctx.session.userId, ['owner', 'editor']);
      await db.delete(secrets).where(eq(secrets.id, input.secretId));
      return { ok: true };
    }),

  /**
   * Searches secret names across ALL vaults the user is an active member of.
   * Used by the command palette (Ctrl+K). Never returns ciphertext.
   */
  globalSearch: protectedProcedure
    .input(z.object({ query: z.string().max(200) }))
    .query(async ({ input, ctx }) => {
      const q = input.query.trim();
      if (!q) return [];

      const memberships = await db
        .select({ vaultId: vaultMembers.vaultId })
        .from(vaultMembers)
        .where(
          and(
            eq(vaultMembers.userId, ctx.session.userId),
            eq(vaultMembers.inviteStatus, 'active'),
          ),
        );

      if (memberships.length === 0) return [];

      const vaultIds = memberships.map((m) => m.vaultId);

      return db
        .select({
          id: secrets.id,
          name: secrets.name,
          type: secrets.type,
          vaultId: secrets.vaultId,
          vaultName: vaults.name,
          updatedAt: secrets.updatedAt,
        })
        .from(secrets)
        .innerJoin(vaults, eq(secrets.vaultId, vaults.id))
        .where(and(inArray(secrets.vaultId, vaultIds), ilike(secrets.name, `%${q}%`)))
        .limit(20);
    }),

  /** Returns version history (ciphertext + iv) for a secret. */
  versions: protectedProcedure
    .input(z.object({ secretId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireSecretAccess(input.secretId, ctx.session.userId);

      return db
        .select()
        .from(secretVersions)
        .where(eq(secretVersions.secretId, input.secretId))
        .orderBy(desc(secretVersions.createdAt));
    }),
});
