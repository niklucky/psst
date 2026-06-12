import { db, folders, vaultMembers } from '@silo/db';
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

async function requireFolderAccess(
  folderId: string,
  userId: string,
  allowedRoles: string[] = ['owner', 'editor', 'viewer'],
) {
  const [row] = await db
    .select({ vaultId: folders.vaultId, role: vaultMembers.role })
    .from(folders)
    .innerJoin(
      vaultMembers,
      and(eq(vaultMembers.vaultId, folders.vaultId), eq(vaultMembers.userId, userId)),
    )
    .where(eq(folders.id, folderId))
    .limit(1);

  if (!row || !allowedRoles.includes(row.role)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return row;
}

export const foldersRouter = router({
  /**
   * Returns all folders for a vault as a flat list.
   * Clients build the tree from parentId references.
   */
  list: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId);

      return db
        .select()
        .from(folders)
        .where(eq(folders.vaultId, input.vaultId))
        .orderBy(folders.name);
    }),

  /** Creates a folder. parentId is optional (null = root). */
  create: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        parentId: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner', 'editor']);

      const [folder] = await db
        .insert(folders)
        .values({
          vaultId: input.vaultId,
          parentId: input.parentId ?? null,
          name: input.name,
        })
        .returning();

      return folder;
    }),

  /** Renames a folder. */
  rename: protectedProcedure
    .input(z.object({ folderId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      await requireFolderAccess(input.folderId, ctx.session.userId, ['owner', 'editor']);

      await db
        .update(folders)
        .set({ name: input.name })
        .where(eq(folders.id, input.folderId));

      return { ok: true };
    }),

  /** Deletes a folder. Cascade on DB handles sub-folders; secrets get folder_id set null. */
  delete: protectedProcedure
    .input(z.object({ folderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireFolderAccess(input.folderId, ctx.session.userId, ['owner', 'editor']);
      await db.delete(folders).where(eq(folders.id, input.folderId));
      return { ok: true };
    }),
});
