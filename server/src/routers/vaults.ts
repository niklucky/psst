import {
  db,
  vaults,
  vaultMembers,
  organisations,
  organisationMembers,
  secrets,
} from '@psst/db';
import { TRPCError } from '@trpc/server';
import { and, count, eq, max } from 'drizzle-orm';
import { z } from 'zod/v4';
import { protectedProcedure, router } from '../trpc';

/** Verify the calling user has access to a vault; optionally enforce a minimum role. */
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

export const vaultsRouter = router({
  /**
   * Lists all vaults the current user is a member of,
   * including their personal encrypted vault key.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: vaults.id,
        name: vaults.name,
        description: vaults.description,
        organisationId: vaults.organisationId,
        createdAt: vaults.createdAt,
        updatedAt: vaults.updatedAt,
        role: vaultMembers.role,
        encryptedVaultKey: vaultMembers.encryptedVaultKey,
        vaultKeyIv: vaultMembers.vaultKeyIv,
      })
      .from(vaultMembers)
      .innerJoin(vaults, eq(vaultMembers.vaultId, vaults.id))
      .where(eq(vaultMembers.userId, ctx.session.userId));

    return rows;
  }),

  /** Returns a single vault with member list and the caller's vault key. */
  get: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId);

      const [vault] = await db
        .select({
          id: vaults.id,
          name: vaults.name,
          description: vaults.description,
          organisationId: vaults.organisationId,
          createdAt: vaults.createdAt,
          updatedAt: vaults.updatedAt,
        })
        .from(vaults)
        .where(eq(vaults.id, input.vaultId))
        .limit(1);

      if (!vault) throw new TRPCError({ code: 'NOT_FOUND' });

      const members = await db
        .select({
          userId: vaultMembers.userId,
          role: vaultMembers.role,
          createdAt: vaultMembers.createdAt,
        })
        .from(vaultMembers)
        .where(eq(vaultMembers.vaultId, input.vaultId));

      const [myKey] = await db
        .select({
          encryptedVaultKey: vaultMembers.encryptedVaultKey,
          vaultKeyIv: vaultMembers.vaultKeyIv,
        })
        .from(vaultMembers)
        .where(
          and(
            eq(vaultMembers.vaultId, input.vaultId),
            eq(vaultMembers.userId, ctx.session.userId),
          ),
        )
        .limit(1);

      return { ...vault, members, encryptedVaultKey: myKey?.encryptedVaultKey, vaultKeyIv: myKey?.vaultKeyIv };
    }),

  /**
   * Creates a new vault and adds the creator as owner.
   * The client must supply the vault key already encrypted with their master key.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        organisationId: z.string().uuid(),
        encryptedVaultKey: z.string().min(1),
        vaultKeyIv: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the user belongs to the org
      const [orgMembership] = await db
        .select({ id: organisationMembers.id })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, input.organisationId),
            eq(organisationMembers.userId, ctx.session.userId),
          ),
        )
        .limit(1);

      if (!orgMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' });
      }

      const result = await db.transaction(async (tx) => {
        const [vault] = await tx
          .insert(vaults)
          .values({
            organisationId: input.organisationId,
            name: input.name,
            createdBy: ctx.session.userId,
          })
          .returning();

        if (!vault) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        await tx.insert(vaultMembers).values({
          vaultId: vault.id,
          userId: ctx.session.userId,
          role: 'owner',
          encryptedVaultKey: input.encryptedVaultKey,
          vaultKeyIv: input.vaultKeyIv,
          grantedBy: ctx.session.userId,
        });

        return vault;
      });

      return result;
    }),

  /**
   * Invites a user to a vault.
   * The caller must supply the vault key already re-encrypted for the recipient
   * (done client-side using the recipient's public key via ECDH).
   */
  invite: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['editor', 'viewer']),
        encryptedVaultKey: z.string().min(1),
        vaultKeyIv: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner', 'editor']);

      // Check recipient isn't already a member
      const [existing] = await db
        .select({ id: vaultMembers.id })
        .from(vaultMembers)
        .where(
          and(eq(vaultMembers.vaultId, input.vaultId), eq(vaultMembers.userId, input.userId)),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User is already a vault member' });
      }

      await db.insert(vaultMembers).values({
        vaultId: input.vaultId,
        userId: input.userId,
        role: input.role,
        encryptedVaultKey: input.encryptedVaultKey,
        vaultKeyIv: input.vaultKeyIv,
        grantedBy: ctx.session.userId,
      });

      return { ok: true };
    }),

  /** Removes a member from a vault. Requires owner role. */
  removeMember: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner']);

      if (input.userId === ctx.session.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remove yourself as owner' });
      }

      await db
        .delete(vaultMembers)
        .where(
          and(eq(vaultMembers.vaultId, input.vaultId), eq(vaultMembers.userId, input.userId)),
        );

      return { ok: true };
    }),

  /** Deletes a vault (cascades to all secrets). Requires owner role. */
  delete: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner']);
      await db.delete(vaults).where(eq(vaults.id, input.vaultId));
      return { ok: true };
    }),
});
