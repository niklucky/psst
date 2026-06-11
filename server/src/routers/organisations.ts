import { randomBytes } from 'node:crypto';
import {
  db,
  invitations,
  organisationMembers,
  organisations,
  users,
  userCredentials,
  vaults,
  vaultMembers,
} from '@psst/db';
import { inviteEmail, sendEmail } from '@psst/email';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { env } from '../env';
import { protectedProcedure, router } from '../trpc';

/** 7-day invite TTL */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function requireOrgAccess(
  orgId: string,
  userId: string,
  allowedRoles: string[] = ['owner', 'admin', 'member'],
) {
  const [membership] = await db
    .select({ role: organisationMembers.role })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, orgId),
        eq(organisationMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return membership;
}

export const organisationsRouter = router({
  /** Lists all organisations the current user is a member of. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: organisations.id,
        name: organisations.name,
        slug: organisations.slug,
        role: organisationMembers.role,
      })
      .from(organisationMembers)
      .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
      .where(eq(organisationMembers.userId, ctx.session.userId));
  }),

  /** Returns an organisation and its members. */
  get: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireOrgAccess(input.orgId, ctx.session.userId);

      const [org] = await db
        .select()
        .from(organisations)
        .where(eq(organisations.id, input.orgId))
        .limit(1);

      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });

      const members = await db
        .select({
          userId: organisationMembers.userId,
          email: users.email,
          role: organisationMembers.role,
          joinedAt: organisationMembers.joinedAt,
        })
        .from(organisationMembers)
        .innerJoin(users, eq(users.id, organisationMembers.userId))
        .where(eq(organisationMembers.organisationId, input.orgId));

      return { ...org, members };
    }),

  /** Lists members of an organisation. */
  listMembers: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireOrgAccess(input.orgId, ctx.session.userId);

      return db
        .select({
          userId: organisationMembers.userId,
          email: users.email,
          role: organisationMembers.role,
          joinedAt: organisationMembers.joinedAt,
          publicKey: userCredentials.publicKey,
        })
        .from(organisationMembers)
        .innerJoin(users, eq(users.id, organisationMembers.userId))
        .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(eq(organisationMembers.organisationId, input.orgId));
    }),

  /**
   * Creates an invitation for an email address and emails the recipient a link
   * to accept it.
   */
  invite: protectedProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        email: z.email(),
        role: z.enum(['admin', 'member']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgAccess(input.orgId, ctx.session.userId, ['owner', 'admin']);

      const [org] = await db
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, input.orgId))
        .limit(1);

      const [inviter] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.userId))
        .limit(1);

      if (!org || !inviter) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      const [invite] = await db
        .insert(invitations)
        .values({
          orgId: input.orgId,
          email: input.email.toLowerCase(),
          role: input.role,
          token,
          invitedBy: ctx.session.userId,
          expiresAt,
        })
        .returning({ id: invitations.id, token: invitations.token });

      const inviteUrl = `${env.APP_URL}/invite/${token}`;
      const { subject, html, text } = inviteEmail({
        orgName: org.name,
        inviterEmail: inviter.email,
        inviteUrl,
        role: input.role,
      });

      await sendEmail({ to: input.email.toLowerCase(), subject, html, text });

      return { invitationId: invite!.id, token };
    }),

  /**
   * Accepts an invitation token. The calling user becomes a member of the org.
   * If the invite has a vaultId, vault access is handled separately via vault.invite.
   */
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [invite] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.token, input.token))
        .limit(1);

      if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid invite token' });
      if (invite.acceptedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite already accepted' });
      }
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite has expired' });
      }

      // Check not already a member
      const [existing] = await db
        .select({ id: organisationMembers.id })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, invite.orgId),
            eq(organisationMembers.userId, ctx.session.userId),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Already a member of this organisation' });
      }

      await db.transaction(async (tx) => {
        await tx.insert(organisationMembers).values({
          organisationId: invite.orgId,
          userId: ctx.session.userId,
          role: invite.role,
          invitedBy: invite.invitedBy ?? undefined,
          joinedAt: new Date(),
        });

        await tx
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invite.id));
      });

      return { orgId: invite.orgId, role: invite.role };
    }),

  /** Removes a member from an organisation. Owner/admin only. */
  removeMember: protectedProcedure
    .input(z.object({ orgId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireOrgAccess(input.orgId, ctx.session.userId, ['owner', 'admin']);

      if (input.userId === ctx.session.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remove yourself' });
      }

      await db
        .delete(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, input.orgId),
            eq(organisationMembers.userId, input.userId),
          ),
        );

      return { ok: true };
    }),

  /** Updates a member's role. Owner only. */
  updateRole: protectedProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['admin', 'member']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgAccess(input.orgId, ctx.session.userId, ['owner']);

      if (input.userId === ctx.session.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot change your own role' });
      }

      await db
        .update(organisationMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(organisationMembers.organisationId, input.orgId),
            eq(organisationMembers.userId, input.userId),
          ),
        );

      return { ok: true };
    }),

  /**
   * Lists vaults that belong to an organisation AND that the current user is a member of.
   */
  vaults: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireOrgAccess(input.orgId, ctx.session.userId);

      return db
        .select({
          id: vaults.id,
          name: vaults.name,
          description: vaults.description,
          createdAt: vaults.createdAt,
          role: vaultMembers.role,
        })
        .from(vaults)
        .innerJoin(
          vaultMembers,
          and(
            eq(vaultMembers.vaultId, vaults.id),
            eq(vaultMembers.userId, ctx.session.userId),
            eq(vaultMembers.inviteStatus, 'active'),
          ),
        )
        .where(eq(vaults.organisationId, input.orgId));
    }),

  /**
   * Returns a user's public key by email — needed by clients before
   * encrypting a vault key for a new vault member.
   */
  getUserPublicKey: protectedProcedure
    .input(z.object({ email: z.email() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select({ userId: users.id, publicKey: userCredentials.publicKey })
        .from(users)
        .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      return { userId: row.userId, publicKey: row.publicKey };
    }),
});
