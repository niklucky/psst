# Auth & notifications expansion — staged plan

## Status

This is a multi-session effort — implemented and **manually tested one stage at a
time**. Each stage is marked complete only after the user has hand-tested it.

| Stage | Feature | Status |
|-------|---------|--------|
| 1 | Email service (`@psst/email`, Resend) | ✅ done |
| 2 | Welcome email + email verification | ✅ done |
| 3 | Step-up email verification (new device/location/stale session) | ✅ done |
| 4 | 2FA (TOTP + backup codes) | ✅ done |
| 5 | PassKey (WebAuthn) login, auth-only | ✅ done |
| 6 | Vault recovery key ("forgot my master password") | ⬜ not started |

---

## Context

`psst` is an E2EE secrets manager (Bitwarden-style): the **master key** is derived
client-side as `argon2id(password, masterSalt)` and is the root that unwraps the
user's vault key, their X25519 private key, and (transitively, since
`vaultMembers.encryptedVaultKey` is wrapped under the same master key) every vault
they're a member of. The server only ever sees an `authHash` derived from the
password with a *different* salt (`server/src/routers/auth.ts`). This single fact
shapes every decision below — any new login method either (a) slots in *before* the
existing `/login` → `/unlock` handoff (`apps/web/src/routes/unlock.tsx`) without
touching the encryption keys, or (b) requires genuinely new wrap/unwrap crypto.

Through discussion we landed on six features, ordered so each builds on the
previous one's infrastructure:

1. **Email service** (Resend) — foundation for everything else
2. **Welcome / email-verification** — first real use of the email service; the
   `users.emailVerifiedAt` column already exists and is currently unused
3. **Step-up email verification** on new device/location or stale sessions —
   replaces the magic-link idea (rejected: it would let email-account compromise
   mint sessions; this instead *adds* a check on top of password auth) and
   introduces a shared "pending authentication" mechanism
4. **2FA (TOTP + backup codes)** — optional, reuses the pending-auth mechanism from
   stage 3; **passkey logins are exempt** (WebAuthn already combines possession +
   biometric/PIN — confirmed with you as "strong enough on its own")
5. **PassKey (WebAuthn) login** — **auth-only**: replaces the password step for
   creating a session; the user still lands on the existing `/unlock` screen and
   types their master password to derive the encryption key (confirmed — this
   avoids the much larger PRF-based-vault-unlock crypto lift)
6. **Vault recovery key** — true "forgot my master password" recovery. Answering
   your question: because every vault key the user can access is wrapped under the
   *same* master key, recovering **the master key alone** restores access to the
   personal vault key, the private key, and every shared vault — no per-vault work
   needed, regardless of how many vaults the user belongs to.

---

## Stage 1 — Email service (`@psst/email`)

**Goal:** a minimal, typed wrapper around Resend that the rest of the stages send
through, following the monorepo's existing "no queue, send inline" philosophy
(`docs/plans/initial-implemetation-plan.md:13`).

- New package `packages/email` (`@psst/email`), mirroring `@psst/crypto`'s shape:
  a thin client (`resend` npm package) plus plain template functions returning
  `{ subject, html, text }`. Skip `react-email` for now — templates are simple
  (verification code, security alert, invite) and the project favors minimal deps.
- Env additions in `server/src/env.ts`: `RESEND_API_KEY`, `EMAIL_FROM` (e.g.
  `Psst <noreply@yourdomain>`), `APP_URL` (for links in emails).
- A single `sendEmail({ to, subject, html, text })` choke point so later stages
  (and tests) can mock one thing. In `NODE_ENV=test`/missing API key, log to
  console instead of calling Resend — mirrors the existing
  `console.log('[dev] Invite token...')` pattern in `organisations.ts:137`.
- Wire the existing TODO at `server/src/routers/organisations.ts:136` to actually
  send the invite email — first real consumer, proves the plumbing end-to-end.

**Verify:** unit test the template functions (pure functions → easy to snapshot);
send a real email to your own Resend-verified address via the invite flow in dev.

---

## Stage 2 — Welcome email + email verification

**Goal:** use the email service for onboarding and finally populate
`users.emailVerifiedAt` (currently set at the schema level but never written to).

- On `auth.register`, after the transaction commits, send a welcome email
  containing a verification link/code (single-use, expiring — same shape as the
  existing `invitations` table: `token`, `expiresAt`, `acceptedAt`).
- New `auth.verifyEmail` mutation (or a public route the link hits) that sets
  `emailVerifiedAt = now()`.
- Add a small "resend verification email" action in `apps/web/src/routes/settings/profile.tsx`
  for users who missed/lost the first one.
- Not a hard gate (don't block login on verification) — just a banner/nudge in
  settings, consistent with the app's low-friction posture.

**Verify:** register a test account, confirm the email arrives and the link sets
`emailVerifiedAt`; confirm re-sending works and old tokens are invalidated.

---

## Stage 3 — Step-up email verification (new device / location / stale session)

**Goal:** after password auth succeeds, require an emailed one-time code if the
login looks risky — this is the safer replacement for magic-link auth you asked
about, and it **adds** friction for attackers who only have the password, rather
than opening a new low-friction path to a session.

- New table `known_devices` (id, userId, fingerprintHash, lastSeenAt, createdAt).
  v1 fingerprint = hash of `(IP address, User-Agent)` — no GeoIP dependency needed
  to start; "location changed" and "new browser" both fall out of this one check.
  Real geo-naming ("new login from Berlin, Germany" in the email copy) can be
  layered on later with a local MaxMind GeoLite2 DB if you want nicer messaging.
- New table `pending_authentications` (id, userId, kind, codeHash, expiresAt,
  attempts, ipAddress, userAgent, createdAt) — represents "primary factor passed,
  session not yet issued." This is the shared mechanism stage 4 (2FA) reuses.
- Modify `auth.login` (and the future passkey login in stage 5): instead of
  immediately issuing a session, check `known_devices` + "last login > N days ago"
  (config constant, e.g. 30 days). If risky, create a `pending_authentications` row,
  email a 6-digit code (reusing `generateSessionToken`-style randomness, hashed at
  rest exactly like `sessions.tokenHash`), and return a `challengeId` instead of a
  session. New `auth.verifyLoginChallenge({ challengeId, code })` mutation checks
  the code, issues the session (same code path as today's end of `login`), and
  records the device in `known_devices` so the next login from there is seamless.
- Frontend: small interstitial screen in the `/login` flow ("We sent a code to
  your email") — same form-handling patterns already used in `login.tsx`/`unlock.tsx`
  (react-hook-form + zod).

**Verify:** log in from a fresh browser profile / different network, confirm the
challenge fires and the emailed code completes login; confirm a second login from
the now-known device skips the challenge.

---

## Stage 4 — 2FA (TOTP + backup codes)

**Goal:** optional authenticator-app-based second factor, gated through the same
`pending_authentications` mechanism introduced in stage 3.

- Library: `otpauth` for TOTP generation/verification (no native deps, RFC 6238),
  `qrcode` to render the enrollment QR in the browser.
- New table `totp_credentials` (userId, secret — encrypted at rest using a
  server-side key from env, since unlike vault data this *must* be readable by the
  server to verify codes; `enabled`, `verifiedAt`, `createdAt`).
- New table `backup_codes` (userId, codeHash, usedAt, createdAt) — 8-10 single-use
  codes generated at enrollment, hashed exactly like `sessions.tokenHash`/
  `pending_authentications.codeHash`, shown once, each usable instead of a TOTP code.
- Enrollment flow in settings: generate secret → show QR + manual key → user enters
  a code to confirm → `enabled = true`, backup codes displayed once.
- Login integration: extend the stage-3 `pending_authentications` flow — if the
  user has TOTP enabled, the *kind* of the pending challenge becomes `totp`
  (instead of/in addition to the email-code challenge) and `verifyLoginChallenge`
  checks against `totp_credentials`/`backup_codes` instead of `codeHash`.
- **Passkey logins skip this step entirely** (per your call — WebAuthn is treated
  as already satisfying 2FA). Keep the exemption as a single readable check so it's
  easy to flip later if you change your mind.

**Verify:** enroll TOTP with a real authenticator app (Google Authenticator/Authy/
1Password), confirm login requires a valid code, confirm a backup code works once
and is then rejected on reuse, confirm disabling 2FA requires re-entering the
password + a valid code (not just a click).

---

## Stage 5 — PassKey (WebAuthn) login, auth-only

**Goal:** let users authenticate with a platform passkey instead of typing their
password — but the vault stays encrypted and still requires the master password,
exactly like a returning session does today.

- Libraries: `@simplewebauthn/server` (Node) + `@simplewebauthn/browser` (web) —
  the standard, well-maintained pair; handles all the WebAuthn ceremony plumbing.
- New table `webauthn_credentials` (userId, credentialId, publicKey, counter,
  transports, deviceType, backedUp, name, createdAt, lastUsedAt) — same shape as
  `sessions`/`userCredentials` (per-user rows referencing `users.id` with cascade).
- Settings UI to register a passkey (standard WebAuthn registration ceremony —
  generate options server-side, `startRegistration()` client-side, verify & store).
- New `auth.webauthnLoginOptions`/`auth.webauthnLoginVerify` procedures: resolve the
  user from the credential ID (no email/password needed), verify the signature and
  counter, and — reusing the **exact same session-issuance code path** as `login` —
  return `{ sessionToken, encryptedVaultKey, ... }`. The client stores the token as
  `lockedToken` and the router redirects to `/unlock` exactly as it does today when
  a persisted token survives a reload (`apps/web/src/routes/login.tsx:28-30`).
- Add the same stage-3 device/location step-up check here too, for consistency —
  one risk-check code path for all login methods rather than special-casing.

**Verify:** register a passkey (Touch ID/Windows Hello/security key), log out, log
back in via passkey only — confirm you land on `/unlock` and the master password is
still required to actually see any secrets (this is the crucial security property
to manually confirm, not just that the ceremony succeeds).

---

## Stage 6 — Vault recovery key ("forgot my master password")

**Goal:** the actual fix for permanent-data-loss-on-forgotten-password, using a
high-entropy recovery code that wraps the master key directly.

**Why wrapping the master key (not individual vault keys) is the right shape:**
unwrapping it hands back the *exact* master key the user already has — which then
transparently unwraps the personal vault key, the private key, and every
`vaultMembers.encryptedVaultKey` row, with zero per-vault iteration. This mirrors
the existing `wrapVaultKey`/`unwrapVaultKey` primitives in `@psst/crypto`
(`packages/crypto/src/vault.ts`) — same shape, new keypair (recovery-code-derived
instead of master-key-derived).

**Handling rotation (your question — yes, we can and should regenerate):**
- Opt-in, set up from Security settings (not forced at registration — matches how
  2FA is optional). Generates `recoveryCode` (high-entropy, shown once as
  word-groups/base32 — same "show once, make them confirm they saved it" UX as
  backup codes), derives a wrap key via `deriveMasterKey(recoveryCode, recoverySalt)`,
  and stores `wrappedMasterKey`/`recoverySalt`/IV server-side (new columns on
  `userCredentials` or a dedicated `recovery_keys` table).
- **On successful recovery:** unwrap the master key, then immediately generate a
  *fresh* recovery code, re-wrap the (same) master key under it, and replace the
  stored blob — the used code is now void. Single re-wrap operation (one blob),
  cheap.
- **On normal password change:** because `changePassword` derives a *new* master
  key from the new password, the old recovery blob (wrapping the old master key)
  would go stale. Simplest correct fix without a deeper key-hierarchy refactor:
  treat a password change as implicitly invalidating the recovery code, and prompt
  the user to generate (and save) a fresh one immediately after — same one-time
  reveal UX as initial setup. (A more elaborate fix — introducing a stable
  account-encryption-key independent of the password, à la 1Password's Secret Key,
  so recovery blobs never go stale — is a much larger refactor touching
  register/login/changePassword/unlock; worth a future discussion but out of scope
  here.)
- New `auth.beginRecovery({ email })` / `auth.completeRecovery({ recoveryCode, ... })`
  flow on the server: looks up `wrappedMasterKey`/`recoverySalt`, returns them for
  client-side unwrapping (server never sees the recovery code or the master key,
  same trust boundary as login today), then accepts the new password blobs +
  freshly-rotated recovery blob in one transaction (extends the existing
  `changePassword` transaction shape in `server/src/routers/auth.ts:259-289`).

**Verify:** set up recovery, simulate "forgot password" (clear local state), recover
using only the saved recovery code + new password, confirm full vault access is
restored (personal vault + at least one shared vault), confirm the old recovery
code no longer works and a new one was issued, confirm a normal password change
prompts for a fresh recovery code.
