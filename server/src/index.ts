import 'dotenv/config';
import { serve } from '@hono/node-server';
import { db } from '@psst/db';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env';
import { sessionMiddleware, getSession } from './middleware/session';
import { appRouter } from './routers/index';

const app = new Hono();

// ---- Global middleware ----
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);
app.use('*', sessionMiddleware);

// ---- Health check ----
app.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ ok: true, db: 'connected' });
  } catch {
    return c.json({ ok: false, db: 'error' }, 500);
  }
});

// ---- tRPC handler ----
app.all('/trpc/*', async (c) => {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({
      db,
      session: getSession(c),
    }),
  });
});

// ---- Start server ----
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

export default app;
