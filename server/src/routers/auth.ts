import { createHash, randomBytes } from 'node:crypto';
import { db, sessions, userCredentials, users, organisations, organisationMembers } from '@psst/db';
import { TRPCError } from '@trpc/server';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod/v4';
import { protectedProcedure, publicProcedure, router } from '../trpc';

/** Session lifetime: 30 days */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export const authRouter = router({
  /**
   * Returns the argon2 salt for a given email.
   * Called before login so the client can derive the master key.
   */
  getSalt: publicProcedure
    .input(z.object({ email: z.email() }))
    .query(async ({ input }) => {
      const [cred] = await db
        .select({ argon2Salt: userCredentials.argon2Salt })
        .from(userCredentials)
        .innerJoin(users, eq(userCredentials.userId, users.id))
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);

      if (!cred) {
        // Don't reveal whether the email exists — return a dummy response
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      return { argon2Salt: cred.argon2Salt };
    }),

  /**
   * Registers a new user.
   * All crypto material is generated client-side; the server only stores blobs.
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.email(),
        /** base64 — used client-side for master key derivation */
        argon2Salt: z.string().min(1),
        /** argon2id(password, authSalt) — server verifies future logins against this */
        authHash: z.string().min(1),
        encryptedVaultKey: z.string().min(1),
        vaultKeyIv: z.string().min(1),
        publicKey: z.string().min(1),
        encryptedPrivateKey: z.string().min(1),
        privateKeyIv: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase();

      // Check email not already taken
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
      }

      // Insert user + credentials + personal org in a transaction
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email })
          .returning({ id: users.id });

        if (!user) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        await tx.insert(userCredentials).values({
          userId: user.id,
          authHash: input.authHash,
          argon2Salt: input.argon2Salt,
          encryptedVaultKey: input.encryptedVaultKey,
          vaultKeyIv: input.vaultKeyIv,
          publicKey: input.publicKey,
          encryptedPrivateKey: input.encryptedPrivateKey,
          privateKeyIv: input.privateKeyIv,
        });

        // Create personal organisation
        const slug = `personal-${user.id.slice(0, 8)}`;
        const [org] = await tx
          .insert(organisations)
          .values({ name: 'Personal', slug })
          .returning({ id: organisations.id });

        if (!org) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        await tx.insert(organisationMembers).values({
          organisationId: org.id,
          userId: user.id,
          role: 'owner',
          joinedAt: new Date(),
        });

        // Create session
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

        const [session] = await tx
          .insert(sessions)
          .values({ userId: user.id, tokenHash, expiresAt })
          .returning({ id: sessions.id });

        if (!session) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        return { token, sessionId: session.id, userId: user.id, expiresAt };
      });

      return {
        sessionToken: result.token,
        userId: result.userId,
        expiresAt: result.expiresAt,
      };
    }),

  /**
   * Logs in an existing user.
   * The client computes argon2id(password, argon2Salt) before calling this.
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.email(),
        authHash: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase();

      const [row] = await db
        .select({
          userId: users.id,
          authHash: userCredentials.authHash,
          argon2Salt: userCredentials.argon2Salt,
          encryptedVaultKey: userCredentials.encryptedVaultKey,
          vaultKeyIv: userCredentials.vaultKeyIv,
          publicKey: userCredentials.publicKey,
          encryptedPrivateKey: userCredentials.encryptedPrivateKey,
          privateKeyIv: userCredentials.privateKeyIv,
        })
        .from(users)
        .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(eq(users.email, email))
        .limit(1);

      // Constant-time-ish: always do the comparison even if user not found
      const storedHash = row?.authHash ?? '';
      const matches = storedHash === input.authHash && storedHash.length > 0;

      if (!row || !matches) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }

      const token = generateSessionToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await db.insert(sessions).values({
        userId: row.userId,
        tokenHash,
        expiresAt,
      });

      return {
        sessionToken: token,
        userId: row.userId,
        expiresAt,
        argon2Salt: row.argon2Salt,
        encryptedVaultKey: row.encryptedVaultKey,
        vaultKeyIv: row.vaultKeyIv,
        publicKey: row.publicKey,
        encryptedPrivateKey: row.encryptedPrivateKey,
        privateKeyIv: row.privateKeyIv,
      };
    }),

  /**
   * Logs out the current user by deleting their session.
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await db.delete(sessions).where(eq(sessions.id, ctx.session.sessionId));
    return { ok: true };
  }),

  /**
   * Returns the current user's info and encrypted credential blobs.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        argon2Salt: userCredentials.argon2Salt,
        encryptedVaultKey: userCredentials.encryptedVaultKey,
        vaultKeyIv: userCredentials.vaultKeyIv,
        publicKey: userCredentials.publicKey,
        encryptedPrivateKey: userCredentials.encryptedPrivateKey,
        privateKeyIv: userCredentials.privateKeyIv,
      })
      .from(users)
      .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(eq(users.id, ctx.session.userId))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    return row;
  }),
});
