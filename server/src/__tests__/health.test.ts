import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prevent the real HTTP server from starting
vi.mock('@hono/node-server', () => ({ serve: vi.fn() }));

// Mock the database — the health route calls db.execute(sql`SELECT 1`)
vi.mock('@silo/db', () => ({
  db: {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  users: {},
  userCredentials: {},
  sessions: {},
  organisations: {},
  organisationMembers: {},
  vaultMembers: {},
  vaults: {},
  secrets: {},
  folders: {},
  tags: {},
  secretTags: {},
  secretVersions: {},
  invitations: {},
}));

import { db } from '@silo/db';
import app from '../index';

describe('GET /health', () => {
  beforeEach(() => {
    vi.mocked(db.execute).mockReset();
  });

  it('returns 200 with db connected', async () => {
    vi.mocked(db.execute).mockResolvedValue([] as any);

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, db: 'connected' });
  });

  it('returns 500 when db throws', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('Connection refused'));

    const res = await app.request('/health');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, db: 'error' });
  });
});
