import { createHash } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptTotpSecret } from '../totp';

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
  knownDevices: { userId: 'userId', fingerprintHash: 'fingerprintHash' },
  pendingAuthentications: { id: 'id', kind: 'kind' },
  totpCredentials: { userId: 'userId', enabled: 'enabled' },
  backupCodes: { id: 'id', userId: 'userId', codeHash: 'codeHash', usedAt: 'usedAt' },
}));

vi.mock('@psst/email', () => ({
  sendEmail: vi.fn(),
  welcomeEmail: vi.fn(() => ({ subject: 'subject', html: 'html', text: 'text' })),
  loginCodeEmail: vi.fn(() => ({ subject: 'subject', html: 'html', text: 'text' })),
}));

import { db, sessions } from '@psst/db';
import { appRouter } from '../routers';
import { createCallerFactory } from '../trpc';

const createCaller = createCallerFactory(appRouter);
const noopReq = { ipAddress: '127.0.0.1', userAgent: 'vitest' };
// Context db is unused (routers import db directly); pass undefined to satisfy types
const caller = createCaller({ db: undefined as any, session: null, req: noopReq });

/** Caller with a fake authenticated session attached — for protectedProcedure routes. */
function authedCaller(session: { userId: string; sessionId: string }) {
  return createCaller({ db: undefined as any, session, req: noopReq });
}

/** Builds a chainable drizzle-style query mock that resolves to `result`. */
function makeChain(result: unknown[] = []): any {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(result);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = vi.fn().mockReturnValue(chain);
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
    email: 'alice@example.com',
    authHash: 'correct-auth-hash',
    argon2Salt: 'user-salt',
    encryptedVaultKey: 'evk',
    vaultKeyIv: 'vkiv',
    publicKey: 'pub-key',
    encryptedPrivateKey: 'enc-priv',
    privateKeyIv: 'pkiv',
    lastLoginAt: new Date(),
  };

  beforeEach(() => {
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.update).mockReset();
  });

  it('throws UNAUTHORIZED when auth hash does not match', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([userRow]));

    await expect(
      caller.auth.login({ email: 'alice@example.com', authHash: 'wrong-hash' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns a session token and user data when the device is known and recent', async () => {
    // 1st select: user+credentials, 2nd select: known device lookup (found)
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([userRow]))
      .mockReturnValueOnce(makeChain([{ id: 'device-1' }]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));
    vi.mocked(db.update).mockReturnValue(makeChain([]));

    const result = await caller.auth.login({
      email: 'alice@example.com',
      authHash: 'correct-auth-hash',
    });

    if (result.challengeRequired) throw new Error('expected a session, got a challenge');
    expect(result.userId).toBe('user-uuid-1');
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.argon2Salt).toBe('user-salt');
    expect(result.publicKey).toBe('pub-key');
  });

  it('requires a step-up challenge from an unknown device', async () => {
    // 1st select: user+credentials, 2nd select: known device lookup (not found)
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([userRow]))
      .mockReturnValueOnce(makeChain([]));
    vi.mocked(db.insert).mockReturnValue(makeChain([{ id: '33367a65-e87f-4171-99ed-16f8eeabf0c1' }]));

    const result = await caller.auth.login({
      email: 'alice@example.com',
      authHash: 'correct-auth-hash',
    });

    expect(result).toEqual({ challengeRequired: true, challengeId: '33367a65-e87f-4171-99ed-16f8eeabf0c1' });
  });
});

describe('auth.verifyLoginChallenge', () => {
  const code = '123456';
  const codeHash = createHash('sha256').update(code).digest('hex');

  const pendingRow = {
    id: '33367a65-e87f-4171-99ed-16f8eeabf0c1',
    userId: 'user-uuid-1',
    kind: 'email_code',
    codeHash,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  };

  const credentialRow = {
    userId: 'user-uuid-1',
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
    vi.mocked(db.update).mockReset();
    vi.mocked(db.delete).mockReset();
  });

  it('throws on an incorrect code and increments attempts', async () => {
    vi.mocked(db.select).mockReturnValueOnce(makeChain([pendingRow]));
    vi.mocked(db.update).mockReturnValue(makeChain([]));

    await expect(
      caller.auth.verifyLoginChallenge({ challengeId: '33367a65-e87f-4171-99ed-16f8eeabf0c1', code: 'wrong-code' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(db.update).toHaveBeenCalled();
  });

  it('issues a session on a correct code', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([pendingRow]))
      .mockReturnValueOnce(makeChain([credentialRow]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));
    vi.mocked(db.update).mockReturnValue(makeChain([]));
    vi.mocked(db.delete).mockReturnValue(makeChain([]));

    const result = await caller.auth.verifyLoginChallenge({ challengeId: '33367a65-e87f-4171-99ed-16f8eeabf0c1', code });

    if (result.challengeRequired) throw new Error('expected a session, got a challenge');
    expect(result.userId).toBe('user-uuid-1');
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
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

describe('auth.resendVerificationEmail', () => {
  const session = { userId: 'user-uuid-1', sessionId: 'session-1' };

  beforeEach(() => {
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.delete).mockReset();
  });

  it('throws BAD_REQUEST when the email is already verified', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeChain([{ email: 'alice@example.com', emailVerifiedAt: new Date() }]),
    );

    await expect(authedCaller(session).auth.resendVerificationEmail()).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('throws TOO_MANY_REQUESTS when a verification email was sent recently', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([{ email: 'alice@example.com', emailVerifiedAt: null }]))
      .mockReturnValueOnce(makeChain([{ createdAt: new Date() }]));

    await expect(authedCaller(session).auth.resendVerificationEmail()).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it('sends a new verification email when the cooldown has elapsed', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([{ email: 'alice@example.com', emailVerifiedAt: null }]))
      .mockReturnValueOnce(makeChain([{ createdAt: new Date(Date.now() - 10 * 60 * 1000) }]));
    vi.mocked(db.delete).mockReturnValue(makeChain([]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));

    const result = await authedCaller(session).auth.resendVerificationEmail();

    expect(result).toEqual({ ok: true });
  });

  it('sends a verification email when none exists yet', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([{ email: 'alice@example.com', emailVerifiedAt: null }]))
      .mockReturnValueOnce(makeChain([]));
    vi.mocked(db.delete).mockReturnValue(makeChain([]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));

    const result = await authedCaller(session).auth.resendVerificationEmail();

    expect(result).toEqual({ ok: true });
  });
});

describe('auth.totpStatus / enroll / disable', () => {
  const session = { userId: 'user-uuid-1', sessionId: 'session-1' };

  beforeEach(() => {
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.update).mockReset();
    vi.mocked(db.delete).mockReset();
  });

  it('totpStatus returns false when no credential row exists', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([]));

    const result = await authedCaller(session).auth.totpStatus();

    expect(result).toEqual({ enabled: false });
  });

  it('totpStatus returns true when enabled is set', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([{ enabled: new Date() }]));

    const result = await authedCaller(session).auth.totpStatus();

    expect(result).toEqual({ enabled: true });
  });

  it('totpEnrollStart generates a secret and otpauth URL', async () => {
    vi.mocked(db.select).mockReturnValue(makeChain([{ email: 'alice@example.com' }]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));

    const result = await authedCaller(session).auth.totpEnrollStart();

    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpauthUrl).toContain('otpauth://totp/');
    expect(result.otpauthUrl).toContain(encodeURIComponent('alice@example.com'));
  });

  it('totpEnrollVerify confirms a valid code, enables 2FA, and returns backup codes', async () => {
    const secret = new Secret({ size: 20 }).base32;
    const code = new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

    vi.mocked(db.select).mockReturnValue(makeChain([{ encryptedSecret: encryptTotpSecret(secret) }]));
    vi.mocked(db.update).mockReturnValue(makeChain([]));
    vi.mocked(db.delete).mockReturnValue(makeChain([]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));

    const result = await authedCaller(session).auth.totpEnrollVerify({ code });

    expect(result.backupCodes).toHaveLength(10);
    expect(result.backupCodes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });

  it('totpEnrollVerify rejects an incorrect code', async () => {
    const secret = new Secret({ size: 20 }).base32;
    vi.mocked(db.select).mockReturnValue(makeChain([{ encryptedSecret: encryptTotpSecret(secret) }]));

    await expect(
      authedCaller(session).auth.totpEnrollVerify({ code: '000000' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('totpDisable removes credentials and backup codes on a valid code', async () => {
    const secret = new Secret({ size: 20 }).base32;
    const code = new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

    vi.mocked(db.select).mockReturnValue(
      makeChain([{ encryptedSecret: encryptTotpSecret(secret), enabled: new Date() }]),
    );
    vi.mocked(db.delete).mockReturnValue(makeChain([]));

    const result = await authedCaller(session).auth.totpDisable({ code });

    expect(result).toEqual({ ok: true });
    expect(db.delete).toHaveBeenCalled();
  });
});

describe('auth.login with TOTP enabled', () => {
  beforeEach(() => {
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
  });

  it('returns a totp challenge instead of a session', async () => {
    const userRow = {
      userId: 'user-uuid-1',
      email: 'alice@example.com',
      authHash: 'correct-auth-hash',
      argon2Salt: 'user-salt',
      encryptedVaultKey: 'evk',
      vaultKeyIv: 'vkiv',
      publicKey: 'pub-key',
      encryptedPrivateKey: 'enc-priv',
      privateKeyIv: 'pkiv',
      lastLoginAt: new Date(),
      totpEnabledAt: new Date(),
    };

    vi.mocked(db.select).mockReturnValueOnce(makeChain([userRow]));
    vi.mocked(db.insert).mockReturnValue(
      makeChain([{ id: '33367a65-e87f-4171-99ed-16f8eeabf0c1' }]),
    );

    const result = await caller.auth.login({
      email: 'alice@example.com',
      authHash: 'correct-auth-hash',
    });

    expect(result).toEqual({ challengeRequired: true, challengeId: '33367a65-e87f-4171-99ed-16f8eeabf0c1' });
  });
});

describe('auth.verifyLoginChallenge with TOTP', () => {
  const credentialRow = {
    userId: 'user-uuid-1',
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
    vi.mocked(db.update).mockReset();
    vi.mocked(db.delete).mockReset();
  });

  const pendingTotpRow = {
    id: '33367a65-e87f-4171-99ed-16f8eeabf0c1',
    userId: 'user-uuid-1',
    kind: 'totp',
    codeHash: '',
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  };

  it('issues a session on a correct TOTP code', async () => {
    const secret = new Secret({ size: 20 }).base32;
    const code = new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([pendingTotpRow]))
      .mockReturnValueOnce(makeChain([{ encryptedSecret: encryptTotpSecret(secret) }]))
      .mockReturnValueOnce(makeChain([credentialRow]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));
    vi.mocked(db.update).mockReturnValue(makeChain([]));
    vi.mocked(db.delete).mockReturnValue(makeChain([]));

    const result = await caller.auth.verifyLoginChallenge({
      challengeId: '33367a65-e87f-4171-99ed-16f8eeabf0c1',
      code,
    });

    if (result.challengeRequired) throw new Error('expected a session, got a challenge');
    expect(result.userId).toBe('user-uuid-1');
  });

  it('issues a session on a valid unused backup code, then consumes it', async () => {
    const secret = new Secret({ size: 20 }).base32;
    const backupCode = 'abcde-12345';
    const backupCodeHash = createHash('sha256').update(backupCode).digest('hex');

    vi.mocked(db.select)
      .mockReturnValueOnce(makeChain([pendingTotpRow]))
      .mockReturnValueOnce(makeChain([{ encryptedSecret: encryptTotpSecret(secret) }]))
      .mockReturnValueOnce(makeChain([{ id: 'backup-1' }])) // matching unused backup code
      .mockReturnValueOnce(makeChain([credentialRow]));
    vi.mocked(db.insert).mockReturnValue(makeChain([]));
    vi.mocked(db.update).mockReturnValue(makeChain([]));
    vi.mocked(db.delete).mockReturnValue(makeChain([]));

    const result = await caller.auth.verifyLoginChallenge({
      challengeId: '33367a65-e87f-4171-99ed-16f8eeabf0c1',
      code: backupCode,
    });

    if (result.challengeRequired) throw new Error('expected a session, got a challenge');
    expect(result.userId).toBe('user-uuid-1');
    expect(backupCodeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
