import {
  db,
  vaults,
  vaultMembers,
  organisations,
  organisationMembers,
  secrets,
  users,
} from '@silo/db';
import { TRPCError } from '@trpc/server';
import { and, count, eq, inArray } from 'drizzle-orm';
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
   * Lists all vaults the current user is an ACTIVE member of,
   * including their personal encrypted vault key and aggregate counts.
   * Pending invites are excluded — use vault.getPendingInvites for those.
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
      .where(
        and(
          eq(vaultMembers.userId, ctx.session.userId),
          eq(vaultMembers.inviteStatus, 'active'),
        ),
      );

    if (rows.length === 0) return [];

    const vaultIds = rows.map((r) => r.id);

    const [memberCounts, secretCounts] = await Promise.all([
      db
        .select({ vaultId: vaultMembers.vaultId, total: count() })
        .from(vaultMembers)
        .where(inArray(vaultMembers.vaultId, vaultIds))
        .groupBy(vaultMembers.vaultId),
      db
        .select({ vaultId: secrets.vaultId, total: count() })
        .from(secrets)
        .where(inArray(secrets.vaultId, vaultIds))
        .groupBy(secrets.vaultId),
    ]);

    const memberCountMap = new Map(memberCounts.map((r) => [r.vaultId, r.total]));
    const secretCountMap = new Map(secretCounts.map((r) => [r.vaultId, r.total]));

    return rows.map((r) => ({
      ...r,
      memberCount: memberCountMap.get(r.id) ?? 0,
      secretCount: secretCountMap.get(r.id) ?? 0,
    }));
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
   * The caller must supply the vault key already ECDH-encrypted for the recipient
   * (done client-side using the recipient's public key). The invite is stored as
   * 'pending' until the recipient accepts via vault.acceptInvite.
   */
  invite: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['editor', 'viewer']),
        /** ECDH-encrypted vault key (base64) */
        encryptedVaultKey: z.string().min(1),
        vaultKeyIv: z.string().min(1),
        /** Sender's X25519 public key (base64) — needed by recipient to ECDH-decrypt */
        senderPublicKey: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner', 'editor']);

      // Check recipient isn't already a member or has a pending invite
      const [existing] = await db
        .select({ id: vaultMembers.id })
        .from(vaultMembers)
        .where(
          and(eq(vaultMembers.vaultId, input.vaultId), eq(vaultMembers.userId, input.userId)),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'User is already a vault member or has a pending invite',
        });
      }

      await db.insert(vaultMembers).values({
        vaultId: input.vaultId,
        userId: input.userId,
        role: input.role,
        encryptedVaultKey: input.encryptedVaultKey,
        vaultKeyIv: input.vaultKeyIv,
        grantedBy: ctx.session.userId,
        inviteStatus: 'pending',
        senderPublicKey: input.senderPublicKey,
      });

      return { ok: true };
    }),

  /**
   * Returns pending vault invites for the current user.
   * Includes vault name and sender info so the UI can show a meaningful prompt.
   */
  getPendingInvites: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        vaultId: vaultMembers.vaultId,
        vaultName: vaults.name,
        role: vaultMembers.role,
        encryptedVaultKey: vaultMembers.encryptedVaultKey,
        vaultKeyIv: vaultMembers.vaultKeyIv,
        senderPublicKey: vaultMembers.senderPublicKey,
        grantedBy: vaultMembers.grantedBy,
        createdAt: vaultMembers.createdAt,
      })
      .from(vaultMembers)
      .innerJoin(vaults, eq(vaultMembers.vaultId, vaults.id))
      .where(
        and(
          eq(vaultMembers.userId, ctx.session.userId),
          eq(vaultMembers.inviteStatus, 'pending'),
        ),
      );

    // Fetch sender emails for display
    const senderIds = [...new Set(rows.map((r) => r.grantedBy).filter(Boolean) as string[])];
    const senderEmails =
      senderIds.length > 0
        ? await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(users.id, senderIds))
        : [];
    const emailMap = new Map(senderEmails.map((u) => [u.id, u.email]));

    return rows.map((r) => ({
      ...r,
      senderEmail: r.grantedBy ? (emailMap.get(r.grantedBy) ?? null) : null,
    }));
  }),

  /**
   * Accepts a pending vault invite.
   * The client must decrypt the ECDH-wrapped vault key, re-wrap it with their
   * master key, and pass the new ciphertext + iv here.
   */
  acceptInvite: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        /** Master-key-wrapped vault key (replaces the ECDH-encrypted one) */
        encryptedVaultKey: z.string().min(1),
        vaultKeyIv: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [row] = await db
        .select({ id: vaultMembers.id })
        .from(vaultMembers)
        .where(
          and(
            eq(vaultMembers.vaultId, input.vaultId),
            eq(vaultMembers.userId, ctx.session.userId),
            eq(vaultMembers.inviteStatus, 'pending'),
          ),
        )
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No pending invite found' });

      await db
        .update(vaultMembers)
        .set({
          encryptedVaultKey: input.encryptedVaultKey,
          vaultKeyIv: input.vaultKeyIv,
          inviteStatus: 'active',
          senderPublicKey: null,
        })
        .where(eq(vaultMembers.id, row.id));

      return { ok: true };
    }),

  /**
   * Declines and removes a pending vault invite.
   */
  declineInvite: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(vaultMembers)
        .where(
          and(
            eq(vaultMembers.vaultId, input.vaultId),
            eq(vaultMembers.userId, ctx.session.userId),
            eq(vaultMembers.inviteStatus, 'pending'),
          ),
        );
      return { ok: true };
    }),

  /**
   * Returns the member list for a vault with user emails.
   */
  members: protectedProcedure
    .input(z.object({ vaultId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId);

      return db
        .select({
          userId: vaultMembers.userId,
          email: users.email,
          role: vaultMembers.role,
          inviteStatus: vaultMembers.inviteStatus,
          grantedAt: vaultMembers.createdAt,
        })
        .from(vaultMembers)
        .innerJoin(users, eq(vaultMembers.userId, users.id))
        .where(eq(vaultMembers.vaultId, input.vaultId));
    }),

  /**
   * Changes a member's role. Requires owner role.
   * Cannot change your own role (to prevent owner lock-out).
   */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        vaultId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['owner', 'editor', 'viewer']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireVaultAccess(input.vaultId, ctx.session.userId, ['owner']);

      if (input.userId === ctx.session.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot change your own role' });
      }

      const [target] = await db
        .select({ id: vaultMembers.id })
        .from(vaultMembers)
        .where(
          and(eq(vaultMembers.vaultId, input.vaultId), eq(vaultMembers.userId, input.userId)),
        )
        .limit(1);

      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });

      await db
        .update(vaultMembers)
        .set({ role: input.role })
        .where(eq(vaultMembers.id, target.id));

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
