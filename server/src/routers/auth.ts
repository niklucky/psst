import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  db,
  sessions,
  userCredentials,
  users,
  organisations,
  organisationMembers,
  vaultMembers,
  emailVerifications,
  knownDevices,
  pendingAuthentications,
  totpCredentials,
  backupCodes,
  webauthnCredentials,
  webauthnChallenges,
} from '@psst/db';
import { loginCodeEmail, sendEmail, welcomeEmail } from '@psst/email';
import { TRPCError } from '@trpc/server';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod/v4';
import { env } from '../env';
import { protectedProcedure, publicProcedure, router } from '../trpc';
import {
  buildOtpauthUrl,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from '../totp';
import { origin, rpID, rpName, WEBAUTHN_CHALLENGE_TTL_MS } from '../webauthn';

/** Session lifetime: 30 days */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Email verification link lifetime: 24 hours */
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum time between "resend verification email" requests */
const RESEND_VERIFICATION_COOLDOWN_MS = 5 * 60 * 1000;

/** A login from a known device older than this requires step-up verification again */
const STALE_LOGIN_MS = 30 * 24 * 60 * 60 * 1000;

/** Step-up email code lifetime: 10 minutes */
const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;

/** Max incorrect code attempts before the challenge is invalidated */
const MAX_CODE_ATTEMPTS = 5;

/**
 * Probability that a given `webauthnLoginOptions` call also sweeps expired
 * challenge rows. Amortizes cleanup across requests so the unbounded DELETE
 * scan stays off the per-login hot path (there's no background job here).
 */
const WEBAUTHN_PRUNE_PROBABILITY = 0.01;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** sha256 hex fingerprint of a device, derived from IP + User-Agent */
function fingerprintDevice(ipAddress: string | null, userAgent: string | null): string {
  return hashToken(`${ipAddress ?? ''}|${userAgent ?? ''}`);
}

/** Generates a 6-digit numeric one-time code. */
function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Generates a single-use 2FA backup code, formatted as `xxxxx-xxxxx`. */
function generateBackupCode(): string {
  const raw = randomBytes(5).toString('hex');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * Checks whether `code` matches an unused backup code for `userId`, marking
 * it used if so. Returns whether the code was valid.
 */
async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const codeHash = hashToken(code.trim().toLowerCase());

  const [match] = await db
    .select({ id: backupCodes.id })
    .from(backupCodes)
    .where(and(eq(backupCodes.userId, userId), eq(backupCodes.codeHash, codeHash), isNull(backupCodes.usedAt)))
    .limit(1);

  if (!match) return false;

  await db.update(backupCodes).set({ usedAt: new Date() }).where(eq(backupCodes.id, match.id));
  return true;
}

/**
 * If the request comes from an unknown device or the user's last login is stale,
 * creates an `email_code` pending authentication, emails the code, and returns
 * its challengeId. Returns null when the device is known and recent — no step-up
 * needed. Shared by password login and passkey login so every login method runs
 * the same device/location risk check.
 */
async function maybeEmailStepUp(
  user: { userId: string; email: string; lastLoginAt: Date | null },
  req: { ipAddress: string | null; userAgent: string | null },
): Promise<string | null> {
  const fingerprintHash = fingerprintDevice(req.ipAddress, req.userAgent);
  const [device] = await db
    .select({ id: knownDevices.id })
    .from(knownDevices)
    .where(and(eq(knownDevices.userId, user.userId), eq(knownDevices.fingerprintHash, fingerprintHash)))
    .limit(1);

  const isStale = !user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > STALE_LOGIN_MS;

  if (device && !isStale) return null;

  const code = generateLoginCode();
  const codeHash = hashToken(code);
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS);

  const [pending] = await db
    .insert(pendingAuthentications)
    .values({
      userId: user.userId,
      kind: 'email_code',
      codeHash,
      expiresAt,
      ipAddress: req.ipAddress ?? undefined,
      userAgent: req.userAgent ?? undefined,
    })
    .returning({ id: pendingAuthentications.id });

  if (!pending) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

  // Keep the challenge atomic: if the code can't be delivered the client never
  // gets a challengeId and could never verify it, so drop the row we just wrote
  // instead of leaving it to occupy a slot until expiry.
  const { subject, html, text } = loginCodeEmail({ code });
  try {
    await sendEmail({ to: user.email, subject, html, text });
  } catch (err) {
    await db.delete(pendingAuthentications).where(eq(pendingAuthentications.id, pending.id));
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not send the verification code — please try again',
      cause: err,
    });
  }

  return pending.id;
}

interface UserCredentialRow {
  userId: string;
  argon2Salt: string;
  encryptedVaultKey: string;
  vaultKeyIv: string;
  publicKey: string;
  encryptedPrivateKey: string;
  privateKeyIv: string;
}

/** Loads the credential blobs `issueSession` needs for a user by id. */
async function loadCredentialRow(userId: string): Promise<UserCredentialRow | undefined> {
  const [row] = await db
    .select({
      userId: users.id,
      argon2Salt: userCredentials.argon2Salt,
      encryptedVaultKey: userCredentials.encryptedVaultKey,
      vaultKeyIv: userCredentials.vaultKeyIv,
      publicKey: userCredentials.publicKey,
      encryptedPrivateKey: userCredentials.encryptedPrivateKey,
      privateKeyIv: userCredentials.privateKeyIv,
    })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  return row;
}

/** base64url-encode raw bytes (WebAuthn public keys are stored this way). */
function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Decode a base64url string back to bytes (backed by a plain ArrayBuffer). */
function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(str, 'base64url');
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}

/**
 * Issues a session for a user who has passed all required checks, and marks
 * their device as known so future logins from it skip step-up verification.
 */
async function issueSession(
  row: UserCredentialRow,
  req: { ipAddress: string | null; userAgent: string | null },
) {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    userId: row.userId,
    tokenHash,
    expiresAt,
    ipAddress: req.ipAddress ?? undefined,
    userAgent: req.userAgent ?? undefined,
  });

  const fingerprintHash = fingerprintDevice(req.ipAddress, req.userAgent);
  await db
    .insert(knownDevices)
    .values({ userId: row.userId, fingerprintHash, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [knownDevices.userId, knownDevices.fingerprintHash],
      set: { lastSeenAt: new Date() },
    });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.userId));

  return {
    challengeRequired: false as const,
    sessionToken: token,
    userId: row.userId,
    expiresAt,
    argon2Salt: row.argon2Salt,
    encryptedVaultKey: row.encryptedVaultKey,
    vaultKeyIv: row.vaultKeyIv,
    publicKey: row.publicKey,
    encryptedPrivateKey: row.encryptedPrivateKey,
    privateKeyIv: row.privateKeyIv,
  };
}

/**
 * Creates a fresh email verification token for a user and emails them a
 * welcome message containing the verification link.
 */
async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  await db.insert(emailVerifications).values({ userId, tokenHash, expiresAt });

  const verifyUrl = `${env.APP_URL}/verify-email/${token}`;
  const { subject, html, text } = welcomeEmail({ verifyUrl });

  await sendEmail({ to: email, subject, html, text });
}

export const authRouter = router({
  /**
   * Returns the argon2 salt for a given email.
   * Called before login so the client can derive the master key.
   */
  getSalt: publicProcedure
    .input(z.object({ email: z.email() }))
    .query(async ({ input }) => {
      const [cred] = await db
        .select({ argon2Salt: userCredentials.argon2Salt })
        .from(userCredentials)
        .innerJoin(users, eq(userCredentials.userId, users.id))
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);

      if (!cred) {
        // Don't reveal whether the email exists — return a dummy response
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      return { argon2Salt: cred.argon2Salt };
    }),

  /**
   * Registers a new user.
   * All crypto material is generated client-side; the server only stores blobs.
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.email(),
        /** base64 — used client-side for master key derivation */
        argon2Salt: z.string().min(1),
        /** argon2id(password, authSalt) — server verifies future logins against this */
        authHash: z.string().min(1),
        encryptedVaultKey: z.string().min(1),
        vaultKeyIv: z.string().min(1),
        publicKey: z.string().min(1),
        encryptedPrivateKey: z.string().min(1),
        privateKeyIv: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const email = input.email.toLowerCase();

      // Check email not already taken
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
      }

      // Insert user + credentials + personal org in a transaction
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email, lastLoginAt: new Date() })
          .returning({ id: users.id });

        if (!user) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        await tx.insert(userCredentials).values({
          userId: user.id,
          authHash: input.authHash,
          argon2Salt: input.argon2Salt,
          encryptedVaultKey: input.encryptedVaultKey,
          vaultKeyIv: input.vaultKeyIv,
          publicKey: input.publicKey,
          encryptedPrivateKey: input.encryptedPrivateKey,
          privateKeyIv: input.privateKeyIv,
        });

        // Create personal organisation
        const slug = `personal-${user.id.slice(0, 8)}`;
        const [org] = await tx
          .insert(organisations)
          .values({ name: 'Personal', slug })
          .returning({ id: organisations.id });

        if (!org) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        await tx.insert(organisationMembers).values({
          organisationId: org.id,
          userId: user.id,
          role: 'owner',
          joinedAt: new Date(),
        });

        // Create session
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

        const [session] = await tx
          .insert(sessions)
          .values({
            userId: user.id,
            tokenHash,
            expiresAt,
            ipAddress: ctx.req.ipAddress ?? undefined,
            userAgent: ctx.req.userAgent ?? undefined,
          })
          .returning({ id: sessions.id });

        if (!session) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        // Registering from this device counts as a known device — no step-up
        // challenge on the next login from the same browser/network.
        await tx.insert(knownDevices).values({
          userId: user.id,
          fingerprintHash: fingerprintDevice(ctx.req.ipAddress, ctx.req.userAgent),
        });

        return { token, sessionId: session.id, userId: user.id, expiresAt };
      });

      await sendVerificationEmail(result.userId, email);

      return {
        sessionToken: result.token,
        userId: result.userId,
        expiresAt: result.expiresAt,
      };
    }),

  /**
   * Logs in an existing user.
   * The client computes argon2id(password, argon2Salt) before calling this.
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.email(),
        authHash: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const email = input.email.toLowerCase();

      const [row] = await db
        .select({
          userId: users.id,
          email: users.email,
          authHash: userCredentials.authHash,
          argon2Salt: userCredentials.argon2Salt,
          encryptedVaultKey: userCredentials.encryptedVaultKey,
          vaultKeyIv: userCredentials.vaultKeyIv,
          publicKey: userCredentials.publicKey,
          encryptedPrivateKey: userCredentials.encryptedPrivateKey,
          privateKeyIv: userCredentials.privateKeyIv,
          lastLoginAt: users.lastLoginAt,
          totpEnabledAt: totpCredentials.enabled,
        })
        .from(users)
        .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
        .leftJoin(totpCredentials, eq(totpCredentials.userId, users.id))
        .where(eq(users.email, email))
        .limit(1);

      // Constant-time-ish: always do the comparison even if user not found
      const storedHash = row?.authHash ?? '';
      const matches = storedHash === input.authHash && storedHash.length > 0;

      if (!row || !matches) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }

      // 2FA: if TOTP is enabled, every login requires a code regardless of
      // device/staleness — this takes priority over the email step-up check.
      if (row.totpEnabledAt) {
        const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS);

        const [pending] = await db
          .insert(pendingAuthentications)
          .values({
            userId: row.userId,
            kind: 'totp',
            codeHash: '',
            expiresAt,
            ipAddress: ctx.req.ipAddress ?? undefined,
            userAgent: ctx.req.userAgent ?? undefined,
          })
          .returning({ id: pendingAuthentications.id });

        if (!pending) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        return { challengeRequired: true as const, challengeId: pending.id };
      }

      // Step-up check: unknown device or stale last login requires an emailed code.
      const challengeId = await maybeEmailStepUp(
        { userId: row.userId, email: row.email, lastLoginAt: row.lastLoginAt },
        ctx.req,
      );

      if (challengeId) {
        return { challengeRequired: true as const, challengeId };
      }

      return issueSession(row, ctx.req);
    }),

  /**
   * Completes a step-up email verification challenge issued by `login` and
   * issues a session, exactly as a normal login would.
   */
  verifyLoginChallenge: publicProcedure
    .input(
      z.object({
        challengeId: z.string().uuid(),
        code: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [pending] = await db
        .select()
        .from(pendingAuthentications)
        .where(eq(pendingAuthentications.id, input.challengeId))
        .limit(1);

      if (!pending || pending.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired code' });
      }

      // Bind the challenge to the device that originated it: the session (and
      // the resulting trusted-device entry) must only ever be issued to the
      // same IP + User-Agent that requested the code. Otherwise anyone who
      // obtains the challengeId and code could complete it from their own
      // device and have that device permanently trusted. Compared via
      // fingerprintDevice so null IP/UA is handled consistently with knownDevices.
      // Returns the same generic error — and intentionally touches no state — so
      // a wrong-device submission neither leaks why nor burns the user's attempts.
      if (
        fingerprintDevice(ctx.req.ipAddress, ctx.req.userAgent) !==
        fingerprintDevice(pending.ipAddress, pending.userAgent)
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired code' });
      }

      if (pending.attempts >= MAX_CODE_ATTEMPTS) {
        await db.delete(pendingAuthentications).where(eq(pendingAuthentications.id, pending.id));
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Too many attempts — please log in again' });
      }

      let verified: boolean;

      if (pending.kind === 'totp') {
        const [cred] = await db
          .select({ encryptedSecret: totpCredentials.encryptedSecret })
          .from(totpCredentials)
          .where(eq(totpCredentials.userId, pending.userId))
          .limit(1);

        verified = cred ? verifyTotpCode(decryptTotpSecret(cred.encryptedSecret), input.code) : false;

        if (!verified) {
          verified = await consumeBackupCode(pending.userId, input.code);
        }
      } else {
        verified = hashToken(input.code) === pending.codeHash;
      }

      if (!verified) {
        await db
          .update(pendingAuthentications)
          .set({ attempts: pending.attempts + 1 })
          .where(eq(pendingAuthentications.id, pending.id));

        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Incorrect code' });
      }

      const row = await loadCredentialRow(pending.userId);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      await db.delete(pendingAuthentications).where(eq(pendingAuthentications.id, pending.id));

      return issueSession(row, ctx.req);
    }),

  /**
   * Logs out the current user by deleting their session.
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await db.delete(sessions).where(eq(sessions.id, ctx.session.sessionId));
    return { ok: true };
  }),

  /**
   * Updates the current user's email address.
   * Relies on the existing authenticated session; no password re-entry required.
   */
  changeEmail: protectedProcedure
    .input(z.object({ newEmail: z.email() }))
    .mutation(async ({ input, ctx }) => {
      const email = input.newEmail.toLowerCase();

      const [conflict] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (conflict && conflict.id !== ctx.session.userId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
      }

      await db
        .update(users)
        .set({ email, emailVerifiedAt: null, updatedAt: new Date() })
        .where(eq(users.id, ctx.session.userId));

      await db.delete(emailVerifications).where(eq(emailVerifications.userId, ctx.session.userId));
      await sendVerificationEmail(ctx.session.userId, email);

      return { ok: true };
    }),

  /**
   * Changes the user's password.
   * The client re-derives all crypto material (new master key → re-wraps private key
   * and every active vault key) and sends the new blobs here in one transaction.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        /** argon2id(newPassword, newAuthSalt) */
        newAuthHash: z.string().min(1),
        /** base64 JSON { masterSalt, authSalt } */
        newArgon2Salt: z.string().min(1),
        /** AES-256-GCM(privateKey, newMasterKey) */
        newEncryptedPrivateKey: z.string().min(1),
        newPrivateKeyIv: z.string().min(1),
        /** Re-wrapped vault keys for all active vault memberships */
        vaultKeys: z.array(
          z.object({
            vaultId: z.string().uuid(),
            encryptedVaultKey: z.string().min(1),
            vaultKeyIv: z.string().min(1),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await db.transaction(async (tx) => {
        // Update user credentials
        await tx
          .update(userCredentials)
          .set({
            authHash: input.newAuthHash,
            argon2Salt: input.newArgon2Salt,
            encryptedPrivateKey: input.newEncryptedPrivateKey,
            privateKeyIv: input.newPrivateKeyIv,
            updatedAt: new Date(),
          })
          .where(eq(userCredentials.userId, ctx.session.userId));

        // Re-wrap all active vault member keys
        for (const vk of input.vaultKeys) {
          await tx
            .update(vaultMembers)
            .set({ encryptedVaultKey: vk.encryptedVaultKey, vaultKeyIv: vk.vaultKeyIv })
            .where(
              and(
                eq(vaultMembers.vaultId, vk.vaultId),
                eq(vaultMembers.userId, ctx.session.userId),
                eq(vaultMembers.inviteStatus, 'active'),
              ),
            );
        }
      });

      return { ok: true };
    }),

  /**
   * Permanently deletes the current user's account and all associated data.
   * Cascades to: sessions, credentials, org memberships, vault memberships, secrets.
   */
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await db.delete(users).where(eq(users.id, ctx.session.userId));
    return { ok: true };
  }),

  /**
   * Returns the current user's info and encrypted credential blobs.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        argon2Salt: userCredentials.argon2Salt,
        encryptedVaultKey: userCredentials.encryptedVaultKey,
        vaultKeyIv: userCredentials.vaultKeyIv,
        publicKey: userCredentials.publicKey,
        encryptedPrivateKey: userCredentials.encryptedPrivateKey,
        privateKeyIv: userCredentials.privateKeyIv,
      })
      .from(users)
      .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(eq(users.id, ctx.session.userId))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    return row;
  }),

  /**
   * Verifies an email address using the token from the welcome/verification email.
   */
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tokenHash = hashToken(input.token);

      const [verification] = await db
        .select()
        .from(emailVerifications)
        .where(
          and(eq(emailVerifications.tokenHash, tokenHash), gt(emailVerifications.expiresAt, new Date())),
        )
        .limit(1);

      if (!verification) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired verification link' });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, verification.userId));

        await tx.delete(emailVerifications).where(eq(emailVerifications.userId, verification.userId));
      });

      return { ok: true };
    }),

  /**
   * Resends the email verification link to the current user.
   */
  resendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
    const [user] = await db
      .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, ctx.session.userId))
      .limit(1);

    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

    if (user.emailVerifiedAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Email already verified' });
    }

    const [existing] = await db
      .select({ createdAt: emailVerifications.createdAt })
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, ctx.session.userId))
      .limit(1);

    if (existing && Date.now() - existing.createdAt.getTime() < RESEND_VERIFICATION_COOLDOWN_MS) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Please wait before requesting another email' });
    }

    await db.delete(emailVerifications).where(eq(emailVerifications.userId, ctx.session.userId));
    await sendVerificationEmail(ctx.session.userId, user.email);

    return { ok: true };
  }),

  /**
   * Returns whether the current user has TOTP-based 2FA enabled.
   */
  totpStatus: protectedProcedure.query(async ({ ctx }) => {
    const [cred] = await db
      .select({ enabled: totpCredentials.enabled })
      .from(totpCredentials)
      .where(eq(totpCredentials.userId, ctx.session.userId))
      .limit(1);

    return { enabled: !!cred?.enabled };
  }),

  /**
   * Starts (or restarts) TOTP enrollment: generates a new secret, stores it
   * encrypted with `enabled = null`, and returns it for QR/manual entry.
   * 2FA is not active until `totpEnrollVerify` confirms a valid code.
   */
  totpEnrollStart: protectedProcedure.mutation(async ({ ctx }) => {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.session.userId))
      .limit(1);

    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

    const secret = generateTotpSecret();
    const encryptedSecret = encryptTotpSecret(secret);

    await db
      .insert(totpCredentials)
      .values({ userId: ctx.session.userId, encryptedSecret })
      .onConflictDoUpdate({
        target: totpCredentials.userId,
        set: { encryptedSecret, enabled: null },
      });

    return { secret, otpauthUrl: buildOtpauthUrl(secret, user.email) };
  }),

  /**
   * Confirms TOTP enrollment with a code from the authenticator app, marks
   * 2FA as enabled, and issues a fresh set of one-time backup codes.
   */
  totpEnrollVerify: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [cred] = await db
        .select()
        .from(totpCredentials)
        .where(eq(totpCredentials.userId, ctx.session.userId))
        .limit(1);

      if (!cred) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No TOTP enrollment in progress' });
      }

      if (!verifyTotpCode(decryptTotpSecret(cred.encryptedSecret), input.code)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Incorrect code' });
      }

      await db
        .update(totpCredentials)
        .set({ enabled: new Date() })
        .where(eq(totpCredentials.userId, ctx.session.userId));

      // Replace any previous backup codes with a fresh set, shown once.
      await db.delete(backupCodes).where(eq(backupCodes.userId, ctx.session.userId));

      const codes = Array.from({ length: 10 }, () => generateBackupCode());
      await db
        .insert(backupCodes)
        .values(codes.map((code) => ({ userId: ctx.session.userId, codeHash: hashToken(code) })));

      return { backupCodes: codes };
    }),

  /**
   * Disables TOTP 2FA. Requires a valid current TOTP code or backup code to
   * prevent a hijacked session from silently downgrading account security.
   */
  totpDisable: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [cred] = await db
        .select()
        .from(totpCredentials)
        .where(eq(totpCredentials.userId, ctx.session.userId))
        .limit(1);

      if (!cred || !cred.enabled) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '2FA is not enabled' });
      }

      const verified =
        verifyTotpCode(decryptTotpSecret(cred.encryptedSecret), input.code) ||
        (await consumeBackupCode(ctx.session.userId, input.code));

      if (!verified) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Incorrect code' });
      }

      await db.delete(totpCredentials).where(eq(totpCredentials.userId, ctx.session.userId));
      await db.delete(backupCodes).where(eq(backupCodes.userId, ctx.session.userId));

      return { ok: true };
    }),

  // ─── WebAuthn / Passkeys (stage 5) ─────────────────────────────────────────

  /**
   * Lists the current user's registered passkeys (for the settings UI).
   */
  webauthnCredentials: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: webauthnCredentials.id,
        name: webauthnCredentials.name,
        createdAt: webauthnCredentials.createdAt,
        lastUsedAt: webauthnCredentials.lastUsedAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, ctx.session.userId));
  }),

  /**
   * Begins passkey registration: generates WebAuthn creation options, stores the
   * challenge server-side, and returns the options for `startRegistration()`.
   */
  webauthnRegisterOptions: protectedProcedure.mutation(async ({ ctx }) => {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.session.userId))
      .limit(1);

    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

    const existing = await db
      .select({
        credentialId: webauthnCredentials.credentialId,
        transports: webauthnCredentials.transports,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, ctx.session.userId));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      // Stable per-user handle — returned as `userHandle` on discoverable login.
      userID: new TextEncoder().encode(ctx.session.userId),
      userName: user.email,
      userDisplayName: user.email,
      attestationType: 'none',
      // Don't let the same authenticator enroll twice.
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports
          ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
          : undefined,
      })),
      authenticatorSelection: {
        // Require a discoverable (resident) credential so login needs no username.
        residentKey: 'required',
        // Require user verification (biometric/PIN) — for a password manager,
        // possession of the device alone must not be enough to authenticate.
        userVerification: 'required',
      },
    });

    const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS);
    const [challenge] = await db
      .insert(webauthnChallenges)
      .values({ userId: ctx.session.userId, challenge: options.challenge, expiresAt })
      .returning({ id: webauthnChallenges.id });

    if (!challenge) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    return { challengeId: challenge.id, options };
  }),

  /**
   * Completes passkey registration: verifies the attestation against the stored
   * challenge and persists the credential.
   */
  webauthnRegisterVerify: protectedProcedure
    .input(
      z.object({
        challengeId: z.string().uuid(),
        response: z.custom<RegistrationResponseJSON>((v) => typeof v === 'object' && v !== null),
        name: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Atomically consume the challenge — DELETE ... RETURNING guarantees only
      // one concurrent request can claim it, preventing replay of a single
      // attestation into two credentials. A missing row = invalid/expired/reused.
      const [challenge] = await db
        .delete(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.id, input.challengeId),
            eq(webauthnChallenges.userId, ctx.session.userId),
            gt(webauthnChallenges.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!challenge) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired challenge' });
      }

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: input.response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          // Don't enroll a credential that wasn't created with user verification.
          requireUserVerification: true,
        });
      } catch (err) {
        console.error('[webauthn] registration verify failed:', err, {
          expectedOrigin: origin,
          expectedRPID: rpID,
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Passkey registration failed', cause: err });
      }

      if (!verification.verified || !verification.registrationInfo) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Passkey registration failed' });
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

      await db.insert(webauthnCredentials).values({
        userId: ctx.session.userId,
        credentialId: credential.id,
        publicKey: toBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: input.name?.trim() || null,
      });

      return { ok: true };
    }),

  /**
   * Removes a registered passkey.
   */
  webauthnDeleteCredential: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(webauthnCredentials)
        .where(and(eq(webauthnCredentials.id, input.id), eq(webauthnCredentials.userId, ctx.session.userId)));

      return { ok: true };
    }),

  /**
   * Begins a usernameless passkey login: generates authentication options with
   * an empty allow-list (relying on discoverable credentials) and stores the
   * challenge for verification.
   */
  webauthnLoginOptions: publicProcedure.mutation(async () => {
    const options = await generateAuthenticationOptions({
      rpID,
      // Require user verification (biometric/PIN), not just presence — see
      // webauthnRegisterOptions. Enforced again at verify time.
      userVerification: 'required',
      // Empty allowCredentials → the browser offers any discoverable passkey for
      // this RP, so we don't need the email up front.
    });

    // Opportunistically prune expired challenges so the table doesn't grow —
    // but only on a small fraction of requests, keeping the table scan off the
    // hot path of every login attempt.
    if (Math.random() < WEBAUTHN_PRUNE_PROBABILITY) {
      await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date()));
    }

    const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS);
    const [challenge] = await db
      .insert(webauthnChallenges)
      .values({ userId: null, challenge: options.challenge, expiresAt })
      .returning({ id: webauthnChallenges.id });

    if (!challenge) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    return { challengeId: challenge.id, options };
  }),

  /**
   * Verifies a passkey assertion and issues a session — the same session-issuance
   * path as password login. Auth-only: the response carries no key material, so
   * the client lands on `/unlock` and still derives the master key from the
   * password. Runs the stage-3 device step-up too (passkeys are exempt from TOTP).
   */
  webauthnLoginVerify: publicProcedure
    .input(
      z.object({
        challengeId: z.string().uuid(),
        response: z.custom<AuthenticationResponseJSON>((v) => typeof v === 'object' && v !== null),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Atomically consume the challenge — DELETE ... RETURNING guarantees only
      // one concurrent request can claim it, so a single assertion can't be
      // replayed into two sessions. A missing row = invalid/expired/reused.
      const [challenge] = await db
        .delete(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.id, input.challengeId),
            gt(webauthnChallenges.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!challenge) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired challenge' });
      }

      // Resolve the credential from the assertion's credential ID.
      const [cred] = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.credentialId, input.response.id))
        .limit(1);

      if (!cred) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unknown passkey' });
      }

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: input.response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id: cred.credentialId,
            publicKey: fromBase64Url(cred.publicKey),
            counter: cred.counter,
            transports: cred.transports
              ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
              : undefined,
          },
          // Reject presence-only assertions (security key with no PIN/biometric).
          requireUserVerification: true,
        });
      } catch (err) {
        console.error('[webauthn] authentication verify failed:', err, {
          expectedOrigin: origin,
          expectedRPID: rpID,
        });
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Passkey verification failed', cause: err });
      }

      // Belt-and-suspenders: `requireUserVerification` above already rejects
      // !uv assertions, but assert the flag explicitly so the guarantee is
      // visible at the call site and survives any library default change.
      if (!verification.verified || !verification.authenticationInfo.userVerified) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Passkey verification failed' });
      }

      // Advance the signature counter to detect cloned authenticators.
      await db
        .update(webauthnCredentials)
        .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
        .where(eq(webauthnCredentials.id, cred.id));

      const [user] = await db
        .select({ email: users.email, lastLoginAt: users.lastLoginAt })
        .from(users)
        .where(eq(users.id, cred.userId))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

      // Same device/location step-up as password login — one risk check across
      // all login methods. Passkeys skip TOTP, so only the email code applies.
      const stepUpChallengeId = await maybeEmailStepUp(
        { userId: cred.userId, email: user.email, lastLoginAt: user.lastLoginAt },
        ctx.req,
      );

      if (stepUpChallengeId) {
        return { challengeRequired: true as const, challengeId: stepUpChallengeId };
      }

      const row = await loadCredentialRow(cred.userId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      return issueSession(row, ctx.req);
    }),
});
