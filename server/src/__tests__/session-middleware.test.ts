import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@silo/db', () => ({
  db: { select: vi.fn() },
  sessions: {},
}));

import { db } from '@silo/db';
import { sessionMiddleware } from '../middleware/session';

/** Builds a chainable drizzle-style query mock that resolves to `result`. */
function makeChain(result: unknown[]): any {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

/** Minimal fake of the Hono context surface the middleware touches. */
function makeContext(authHeader?: string) {
  const stored = new Map<string, unknown>();
  return {
    req: { header: vi.fn((name: string) => (name === 'Authorization' ? authHeader : undefined)) },
    set: vi.fn((key: string, value: unknown) => stored.set(key, value)),
    get: (key: string) => stored.get(key),
  } as any;
}

describe('sessionMiddleware', () => {
  beforeEach(() => {
    vi.mocked(db.select).mockReset();
  });

  it('attaches a null session and skips the lookup when there is no Authorization header', async () => {
    const c = makeContext(undefined);
    const next = vi.fn();

    await sessionMiddleware(c, next);

    expect(c.set).toHaveBeenCalledWith('session', null);
    expect(db.select).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('attaches a null session when the header is not a Bearer token', async () => {
    const c = makeContext('Basic dXNlcjpwYXNz');
    const next = vi.fn();

    await sessionMiddleware(c, next);

    expect(c.set).toHaveBeenCalledWith('session', null);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('attaches a null session when the token matches no row', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([]));
    const c = makeContext('Bearer unknown-token');

    await sessionMiddleware(c, vi.fn());

    expect(c.set).toHaveBeenCalledWith('session', null);
  });

  it('attaches a null session when the matching session has expired', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([{ id: 'session-1', userId: 'user-1' }]))
      .mockReturnValueOnce(makeChain([{ expiresAt: new Date(Date.now() - 60_000) }]));
    const c = makeContext('Bearer expired-token');

    await sessionMiddleware(c, vi.fn());

    expect(c.set).toHaveBeenCalledWith('session', null);
  });

  it('attaches { userId, sessionId } when the token resolves to a live session', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([{ id: 'session-1', userId: 'user-1' }]))
      .mockReturnValueOnce(makeChain([{ expiresAt: new Date(Date.now() + 60_000) }]));
    const c = makeContext('Bearer valid-token');
    const next = vi.fn();

    await sessionMiddleware(c, next);

    expect(c.set).toHaveBeenCalledWith('session', { userId: 'user-1', sessionId: 'session-1' });
    expect(next).toHaveBeenCalled();
  });
});
