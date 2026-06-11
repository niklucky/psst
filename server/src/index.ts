import './setup'; // must be first — loads .env before any other module initializes
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { db } from '@psst/db';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getClientIp } from './client-ip';
import { env } from './env';
import { getSession, sessionMiddleware } from './middleware/session';
import { appRouter } from './routers/index';

const app = new Hono();

// ---- Global middleware ----
app.use('*', logger());
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
app.all('/api/trpc/*', async (c) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({
      db,
      session: getSession(c),
      req: {
        ipAddress: getClientIp(c),
        userAgent: c.req.header('user-agent') ?? null,
      },
    }),
  });
});

// ---- Static files (web app) — served from ./public in production ----
app.use('/*', serveStatic({ root: './public' }));
// SPA fallback: unknown paths hand off to client-side router
app.get('/*', serveStatic({ root: './public', path: 'index.html' }));

// ---- Start server ----
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

export default app;
