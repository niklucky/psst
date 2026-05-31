import { initTRPC, TRPCError } from '@trpc/server';
import type { DrizzleClient } from '@psst/db';

/**
 * Shape of the tRPC context — built once per request in middleware.
 */
export interface Context {
  db: DrizzleClient;
  session: { userId: string; sessionId: string } | null;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/**
 * Protected procedure — throws UNAUTHORIZED if no valid session is attached.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
