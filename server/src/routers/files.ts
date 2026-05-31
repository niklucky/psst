import { db, secrets, vaultMembers } from '@psst/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { createPresignedGetUrl, createPresignedPutUrl } from '../storage';
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

export const filesRouter = router({
  /**
   * Issues a pre-signed PUT URL so the client can upload an encrypted file blob
   * directly to object storage. The caller must be an editor or owner of the vault.
   * Returns the storage key to embed in the FilePayload before calling secret.create.
   */
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        filename: z.string().min(1).max(500),
        mimeType: z.string().min(1),
        size: z.number().int().positive().max(100 * 1024 * 1024), // 100 MB cap
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner', 'editor']);

      const storageKey = `files/${input.vaultId}/${randomUUID()}`;
      const uploadUrl = await createPresignedPutUrl(storageKey);

      return { uploadUrl, storageKey };
    }),

  /**
   * Issues a pre-signed GET URL so the client can download an encrypted file blob
   * directly from object storage. Validates that the caller has access to the secret
   * the storage key belongs to.
   */
  getDownloadUrl: protectedProcedure
    .input(
      z.object({
        secretId: z.string().uuid(),
        storageKey: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const [row] = await db
        .select({ vaultId: secrets.vaultId })
        .from(secrets)
        .where(eq(secrets.id, input.secretId))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      await requireVaultAccess(row.vaultId, ctx.session.userId);

      const downloadUrl = await createPresignedGetUrl(input.storageKey);
      return { downloadUrl };
    }),
});
