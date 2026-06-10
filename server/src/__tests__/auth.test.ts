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
  emailVerifications: {},
}));

vi.mock('@psst/email', () => ({
  sendEmail: vi.fn(),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html', text: 'text' })),
}));

import { db, sessions } from '@psst/db';
import { appRouter } from '../routers';
import { createCallerFactory } from '../trpc';

const createCaller = createCallerFactory(appRouter);
// Context db is unused (routers import db directly); pass undefined to satisfy types
const caller = createCaller({ db: undefined as any, session: null });

/** Caller with a fake authenticated session attached — for protectedProcedure routes. */
function authedCaller(session: { userId: string; sessionId: string }) {
  return createCaller({ db: undefined as any, session });
}

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

describe('auth.register', () => {
  const validInput = {
    email: 'newuser@example.com',
    argon2Salt: 'salt',
    authHash: 'hash',
    encryptedVaultKey: 'evk',
    vaultKeyIv: 'iv',
    publicKey: 'pub',
    encryptedPrivateKey: 'epk',
    privateKeyIv: 'piv',
  };

  beforeEach(() => {
    vi.mocked(db.select).mockReset();
    vi.mocked(db.transaction).mockReset();
    vi.mocked(db.insert).mockReset();
  });

  it('throws CONFLICT when the email is already registered', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([{ id: 'existing-user' }]));

    await expect(caller.auth.register(validInput)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('creates the user, personal org, membership and session, returning a fresh token', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([])); // email not taken
    vi.mocked(db.insert).mockReturnValue(makeChain([])); // email verification token insert
    vi.mocked(db.transaction).mockImplementation(
      (async (fn: any) => fn({ insert: vi.fn(() => makeChain([{ id: 'mock-id' }])) })) as any,
    );

    const result = await caller.auth.register(validInput);

    expect(result.userId).toBe('mock-id');
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});

describe('auth.logout', () => {
  beforeEach(() => {
    vi.mocked(db.delete).mockReset();
  });

  it('requires an authenticated session', async () => {
    await expect(caller.auth.logout()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it("deletes the caller's session row", async () => {
    const deleteChain = makeChain([]);
    vi.mocked(db.delete).mockReturnValue(deleteChain);

    const result = await authedCaller({ userId: 'user-1', sessionId: 'session-1' }).auth.logout();

    expect(result).toEqual({ ok: true });
    expect(db.delete).toHaveBeenCalledWith(sessions);
    expect(deleteChain.where).toHaveBeenCalled();
  });
});

describe('auth.me', () => {
  beforeEach(() => {
    vi.mocked(db.select).mockReset();
  });

  it('requires an authenticated session', async () => {
    await expect(caller.auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it("returns the caller's profile and encrypted credential blobs", async () => {
    const row = {
      id: 'user-1',
      email: 'alice@example.com',
      emailVerifiedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      argon2Salt: 'salt',
      encryptedVaultKey: 'evk',
      vaultKeyIv: 'iv',
      publicKey: 'pub',
      encryptedPrivateKey: 'epk',
      privateKeyIv: 'piv',
    };
    vi.mocked(db.select).mockReturnValue(makeChain([row]));

    const result = await authedCaller({ userId: 'user-1', sessionId: 'session-1' }).auth.me();

    expect(result).toEqual(row);
  });

  it('throws NOT_FOUND when the user record no longer exists', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([]));

    await expect(
      authedCaller({ userId: 'ghost', sessionId: 'session-1' }).auth.me(),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
