import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@psst/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
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

import { db } from '@psst/db';
import { appRouter } from '../routers';
import { createCallerFactory } from '../trpc';

const createCaller = createCallerFactory(appRouter);
// Context db is unused (routers import db directly); pass undefined to satisfy types
const caller = createCaller({ db: undefined as any, session: null });

/** Builds a chainable drizzle-style query mock that resolves to `result`. */
function makeChain(result: unknown[] = []): any {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(result);
  chain.set = vi.fn().mockReturnValue(chain);
  // Make the chain directly awaitable (insert/update/delete without .returning())
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('auth.getSalt', () => {
  beforeEach(() => {
    vi.mocked(db.select).mockReset();
  });

  it('throws NOT_FOUND when the user does not exist', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([]));

    await expect(
      caller.auth.getSalt({ email: 'ghost@example.com' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns the argon2 salt when the user exists', async () => {
    vi.mocked(db.select).mockReturnValue(
      makeChain([{ argon2Salt: 'base64-salt-value' }])
    );

    const result = await caller.auth.getSalt({ email: 'alice@example.com' });

    expect(result.argon2Salt).toBe('base64-salt-value');
  });
});

describe('auth.login', () => {
  const userRow = {
    userId: 'user-uuid-1',
    authHash: 'correct-auth-hash',
    argon2Salt: 'user-salt',
    encryptedVaultKey: 'evk',
    vaultKeyIv: 'vkiv',
    publicKey: 'pub-key',
    encryptedPrivateKey: 'enc-priv',
    privateKeyIv: 'pkiv',
  };

  beforeEach(() => {
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
  });

  it('throws UNAUTHORIZED when auth hash does not match', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([userRow]));

    await expect(
      caller.auth.login({ email: 'alice@example.com', authHash: 'wrong-hash' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns a session token and user data on valid credentials', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([userRow]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));

    const result = await caller.auth.login({
      email: 'alice@example.com',
      authHash: 'correct-auth-hash',
    });

    expect(result.userId).toBe('user-uuid-1');
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.argon2Salt).toBe('user-salt');
    expect(result.publicKey).toBe('pub-key');
  });
});
