import { db, secretTags, tags, vaultMembers } from '@silo/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { protectedProcedure, router } from '../trpc';

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

export const tagsRouter = router({
  /** Returns all tags for a vault. */
  list: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId);

      return db
        .select()
        .from(tags)
        .where(eq(tags.vaultId, input.vaultId))
        .orderBy(tags.name);
    }),

  /** Creates a tag. Name must be unique within the vault (enforced by DB). */
  create: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        name: z.string().min(1).max(50),
        colour: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner', 'editor']);

      try {
        const [tag] = await db
          .insert(tags)
          .values({ vaultId: input.vaultId, name: input.name, colour: input.colour ?? null })
          .returning();

        return tag;
      } catch {
        throw new TRPCError({ code: 'CONFLICT', message: 'Tag name already exists in this vault' });
      }
    }),

  /** Deletes a tag. DB cascade removes all secret_tags rows. */
  delete: protectedProcedure
    .input(z.object({ tagId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Look up the vault via the tag to check access
      const [tag] = await db
        .select({ vaultId: tags.vaultId })
        .from(tags)
        .where(eq(tags.id, input.tagId))
        .limit(1);

      if (!tag) throw new TRPCError({ code: 'NOT_FOUND' });

      await requireVaultAccess(tag.vaultId, ctx.session.userId, ['owner', 'editor']);
      await db.delete(tags).where(eq(tags.id, input.tagId));
      return { ok: true };
    }),

  /** Attaches a tag to a secret. */
  attach: protectedProcedure
    .input(z.object({ secretId: z.string().uuid(), tagId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify tag belongs to the same vault the user can access
      const [tag] = await db
        .select({ vaultId: tags.vaultId })
        .from(tags)
        .where(eq(tags.id, input.tagId))
        .limit(1);

      if (!tag) throw new TRPCError({ code: 'NOT_FOUND' });

      await requireVaultAccess(tag.vaultId, ctx.session.userId, ['owner', 'editor']);

      await db
        .insert(secretTags)
        .values({ secretId: input.secretId, tagId: input.tagId })
        .onConflictDoNothing();

      return { ok: true };
    }),

  /** Detaches a tag from a secret. */
  detach: protectedProcedure
    .input(z.object({ secretId: z.string().uuid(), tagId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [tag] = await db
        .select({ vaultId: tags.vaultId })
        .from(tags)
        .where(eq(tags.id, input.tagId))
        .limit(1);

      if (!tag) throw new TRPCError({ code: 'NOT_FOUND' });

      await requireVaultAccess(tag.vaultId, ctx.session.userId, ['owner', 'editor']);

      await db
        .delete(secretTags)
        .where(and(eq(secretTags.secretId, input.secretId), eq(secretTags.tagId, input.tagId)));

      return { ok: true };
    }),
});
