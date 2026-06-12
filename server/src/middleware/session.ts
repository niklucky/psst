import { createHash } from 'node:crypto';
import { db } from '@silo/db';
import { sessions } from '@silo/db';
import { eq, gt } from 'drizzle-orm';
import type { Context as HonoContext, MiddlewareHandler } from 'hono';
import type { Context } from '../trpc';

/**
 * Resolves the session from the Authorization: Bearer <token> header.
 * Attaches { userId, sessionId } to the Hono context if valid; null otherwise.
 */
export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    c.set('session', null);
    return next();
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();

  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    c.set('session', null);
    return next();
  }

  // Check expiry in application layer (belt-and-suspenders)
  const [fresh] = await db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, row.id))
    .limit(1);

  if (!fresh || fresh.expiresAt < now) {
    c.set('session', null);
    return next();
  }

  c.set('session', { userId: row.userId, sessionId: row.id });
  return next();
};

/** Helper used by tRPC context builder to read session from Hono context */
export function getSession(c: HonoContext): Context['session'] {
  return (c.get('session') as Context['session']) ?? null;
}
