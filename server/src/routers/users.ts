import { db, userCredentials, users } from '@silo/db';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { protectedProcedure, router } from '../trpc';

export const usersRouter = router({
  /**
   * Looks up a registered user by email and returns their public key.
   * Used by the invite flow so the inviter can ECDH-encrypt the vault key
   * for the recipient before calling vault.invite.
   */
  getPublicKey: protectedProcedure
    .input(z.object({ email: z.email() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select({
          userId: users.id,
          publicKey: userCredentials.publicKey,
        })
        .from(users)
        .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No user found with that email' });
      }

      return { userId: row.userId, publicKey: row.publicKey };
    }),
});
