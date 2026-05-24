# Psst — implementation plan for Claude Code

This a platform for managing secrets, organisations, and vaults.

Each phase is a discrete Claude Code session. Review and commit before starting the next.
Keep sessions small: one concern per session, one PR per session.

---

## Decisions locked in

- **No Redis** — sessions in Postgres, no cache layer until proven needed
- **No queue** — email and file ops inline; add `pgboss` (Postgres-backed) only when needed
- **tRPC** over Hono adapter — shared types across web and React Native
- **Drizzle ORM** — schema-first, fully typed, no magic
- **Zod** — validation at every boundary (tRPC input, env vars, crypto outputs)
- **Turborepo + pnpm workspaces** — monorepo tooling

---

## Phase 0 — monorepo scaffold

> Goal: empty but runnable repo. Every app boots. CI passes on an empty commit.

### ✅ Session 0.1 — root scaffold — DONE (commit f50c499)

```
Scaffold a Turborepo monorepo with pnpm workspaces.

Root structure:
  apps/
    web/          (Vite + React + TypeScript)
    desktop/      (Tauri + React, shares web's UI)
    mobile/       (Expo + React Native)
    extension/    (WXT — Chrome + Firefox)
    cli/          (TypeScript, Node, compiled with tsup)
  packages/
    crypto/       (@psst/crypto)
    db/           (@psst/db — Drizzle schema + client)
    api/          (@psst/api — tRPC router definitions)
    ui/           (@psst/ui — shared React components)
    types/        (@psst/types — Zod schemas + inferred types)
    config/       (@psst/config — shared tsconfig, eslint, prettier)
  server/         (Hono + tRPC adapter — the actual API process)

Root files:
  turbo.json        (pipelines: build, dev, lint, typecheck)
  pnpm-workspace.yaml
  package.json      (root scripts only, no dependencies)
  .env.example
  .gitignore

Each app and package needs:
  package.json with correct name (@psst/web etc.)
  tsconfig.json extending @psst/config/tsconfig.base.json
  A placeholder index or main file so the build doesn't fail

Do not install app-specific dependencies yet. Scaffold structure only.
```

### ✅ Session 0.2 — shared config package — DONE (commit 620eb6f)

```
Implement @psst/config.

Contents:
  tsconfig.base.json   — strict TypeScript, ESNext, bundler moduleResolution
  tsconfig.node.json   — for Node processes (server, cli)
  tsconfig.react.json  — jsx: react-jsx
  .eslintrc.base.js    — @typescript-eslint/recommended, import ordering
  prettier.config.js   — single quotes, trailing commas, 100 char line length

All other packages and apps should extend from these.
Update every tsconfig.json in the monorepo to extend the correct base.
Run `pnpm tsc --noEmit` from root to verify zero errors on empty files.
```

### ✅ Session 0.3 — CI pipeline — DONE (commit a858149)

```
Add GitHub Actions CI.

File: .github/workflows/ci.yml

Jobs (run in parallel where possible):
  typecheck   — pnpm turbo typecheck
  lint        — pnpm turbo lint
  test        — pnpm turbo test (no tests yet, just verify the command runs)

Use pnpm/action-setup and cache pnpm store.
Use Turborepo remote caching with TURBO_TOKEN secret (leave placeholder).
Pipeline should pass green on the empty scaffold.
```

---

## Phase 1 — crypto package

> Goal: the entire key hierarchy implemented, tested, zero-knowledge correct.
> This is the most important phase. Do not proceed to the database until this is solid.

### ✅ Session 1.1 — primitives — DONE (commit 6add596, 13/13 tests)

```
Implement @psst/crypto using @noble/ciphers and @noble/hashes.

File: packages/crypto/src/primitives.ts

Functions to implement:
  generateSalt(): Uint8Array          — 16 random bytes
  generateKey(): Uint8Array           — 32 random bytes  
  generateIV(): Uint8Array            — 12 random bytes
  deriveMasterKey(
    password: string,
    salt: Uint8Array
  ): Uint8Array                       — argon2id, m:65536 t:3 p:4 dkLen:32
  encrypt(
    plaintext: Uint8Array,
    key: Uint8Array
  ): { ciphertext: Uint8Array; iv: Uint8Array }   — AES-256-GCM
  decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array
  ): Uint8Array                       — AES-256-GCM, throws on bad tag

All functions pure, no side effects, no global state.
Export a single index.ts.

Add Vitest. Write tests:
  - encrypt then decrypt round-trips correctly
  - decrypt with wrong key throws
  - decrypt with wrong IV throws
  - deriveMasterKey is deterministic (same password + salt = same key)
  - deriveMasterKey produces different output for different salts
```

### ✅ Session 1.2 — vault key operations — DONE (commit 633cc25, 19/19 tests)

```
Implement high-level vault key operations in @psst/crypto.

File: packages/crypto/src/vault.ts

Functions:
  createVaultKey(): Uint8Array
    — generates a random 32-byte vault key

  wrapVaultKey(
    vaultKey: Uint8Array,
    masterKey: Uint8Array
  ): { encryptedVaultKey: Uint8Array; iv: Uint8Array }
    — encrypts vault key with master key

  unwrapVaultKey(
    encryptedVaultKey: Uint8Array,
    masterKey: Uint8Array,
    iv: Uint8Array
  ): Uint8Array
    — decrypts vault key, throws if master key is wrong

  encryptSecret(
    plaintext: string,
    vaultKey: Uint8Array
  ): { ciphertext: Uint8Array; iv: Uint8Array }
    — utf8 encode then AES-256-GCM encrypt

  decryptSecret(
    ciphertext: Uint8Array,
    vaultKey: Uint8Array,
    iv: Uint8Array
  ): string
    — decrypt then utf8 decode

Tests:
  - full signup simulation: derive master key → create vault key → wrap → unwrap → encrypt secret → decrypt secret
  - wrong master password fails at unwrapVaultKey, not at decryptSecret
  - each encryptSecret call produces a different IV (verify randomness)
```

### ✅ Session 1.3 — keypair operations (for team sharing) — DONE (commit 112d993, 26/26 tests)

```
Implement X25519 keypair operations in @psst/crypto.

File: packages/crypto/src/sharing.ts

Functions:
  generateKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array }
    — X25519 keypair via @noble/curves/x25519

  wrapPrivateKey(
    privateKey: Uint8Array,
    masterKey: Uint8Array
  ): { encryptedPrivateKey: Uint8Array; iv: Uint8Array }
    — encrypt private key with master key for storage

  unwrapPrivateKey(
    encryptedPrivateKey: Uint8Array,
    masterKey: Uint8Array,
    iv: Uint8Array
  ): Uint8Array

  encryptVaultKeyForRecipient(
    vaultKey: Uint8Array,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array
  ): { ciphertext: Uint8Array; iv: Uint8Array }
    — ECDH shared secret → encrypt vault key

  decryptVaultKeyFromSender(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    senderPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array
  ): Uint8Array
    — ECDH shared secret → decrypt vault key

Tests:
  - Alice shares vault with Bob: Alice encrypts vault key for Bob → Bob decrypts it → Bob can decrypt secrets
  - Wrong private key fails decryption
  - ECDH is symmetric (shared secret is same from both directions)
```

### ✅ Session 1.4 — encoding helpers — DONE (commit 4e6404b, 26/26 tests)

```
Add encoding utilities to @psst/crypto — needed for serialising binary to/from the DB and API.

File: packages/crypto/src/encoding.ts

Functions:
  toBase64(bytes: Uint8Array): string
  fromBase64(str: string): Uint8Array
  toHex(bytes: Uint8Array): string
  fromHex(str: string): Uint8Array
  textToBytes(str: string): Uint8Array
  bytesToText(bytes: Uint8Array): string

These wrap the @noble built-ins so the rest of the codebase never imports @noble directly — only @psst/crypto.

Update packages/crypto/src/index.ts to export everything.
Run all existing tests. Zero failures required before proceeding.
```

---

## Phase 2 — database schema

> Goal: complete Drizzle schema, migrations, seed script. No application logic yet.

### ✅ Session 2.1 — Drizzle setup — DONE (commit 9ea88a2)

```
Set up @psst/db package.

Install: drizzle-orm, drizzle-kit, pg, @types/pg, dotenv

Files:
  packages/db/src/client.ts    — creates and exports a pg Pool + drizzle client
  packages/db/src/index.ts     — re-exports schema + client
  packages/db/drizzle.config.ts
  packages/db/.env.example     — DATABASE_URL=postgres://...

The client should read DATABASE_URL from environment.
Use connection pooling (max: 10).
Add a `db:generate` and `db:migrate` script to package.json.
```

### ✅ Session 2.2 — users and auth schema — DONE (commit c05aa87)

```
Define users and auth tables in @psst/db using Drizzle.

File: packages/db/src/schema/users.ts

Tables:

  users
    id                    uuid primary key default gen_random_uuid()
    email                 text unique not null
    email_verified_at     timestamp
    created_at            timestamp default now()
    updated_at            timestamp default now()

  user_credentials
    id                    uuid primary key
    user_id               uuid references users(id) on delete cascade
    auth_hash             text not null        — argon2id of password, for login
    argon2_salt           text not null        — base64, for key derivation
    encrypted_vault_key   text not null        — base64 AES-GCM ciphertext
    vault_key_iv          text not null        — base64 12-byte nonce
    public_key            text not null        — base64 X25519 public key
    encrypted_private_key text not null        — base64 AES-GCM ciphertext
    private_key_iv        text not null        — base64 12-byte nonce
    created_at            timestamp default now()
    updated_at            timestamp default now()

  sessions
    id                    uuid primary key
    user_id               uuid references users(id) on delete cascade
    token_hash            text unique not null — sha256 of the session token
    expires_at            timestamp not null
    created_at            timestamp default now()
    ip_address            text
    user_agent            text

Generate migration. Run it against a local Postgres instance to verify.
```

### ✅ Session 2.3 — organisation and vault schema — DONE (commit 1b349f8)

```
Define org, vault, and membership tables in @psst/db.

File: packages/db/src/schema/vaults.ts

Tables:

  organisations
    id          uuid primary key default gen_random_uuid()
    name        text not null
    slug        text unique not null
    created_at  timestamp default now()

  organisation_members
    id              uuid primary key
    organisation_id uuid references organisations(id) on delete cascade
    user_id         uuid references users(id) on delete cascade
    role            text not null default 'member'   — owner | admin | member
    invited_by      uuid references users(id)
    joined_at       timestamp
    created_at      timestamp default now()
    unique(organisation_id, user_id)

  vaults
    id              uuid primary key default gen_random_uuid()
    organisation_id uuid references organisations(id) on delete cascade
    name            text not null
    description     text
    created_by      uuid references users(id)
    created_at      timestamp default now()
    updated_at      timestamp default now()

  vault_members
    id            uuid primary key
    vault_id      uuid references vaults(id) on delete cascade
    user_id       uuid references users(id) on delete cascade
    role          text not null default 'viewer'   — owner | editor | viewer
    encrypted_vault_key   text not null   — vault key re-encrypted for this user
    vault_key_iv          text not null
    granted_by    uuid references users(id)
    created_at    timestamp default now()
    unique(vault_id, user_id)

Generate and run migration.
```

### ✅ Session 2.4 — secrets schema — DONE (commit 5ccccd6)

```
Define secrets, folders, and tags tables in @psst/db.

File: packages/db/src/schema/secrets.ts

Tables:

  folders
    id          uuid primary key default gen_random_uuid()
    vault_id    uuid references vaults(id) on delete cascade
    parent_id   uuid references folders(id) on delete cascade  — nullable, for nesting
    name        text not null    — store plaintext (folder names are metadata, not secrets)
    created_at  timestamp default now()

  secrets
    id          uuid primary key default gen_random_uuid()
    vault_id    uuid references vaults(id) on delete cascade
    folder_id   uuid references folders(id) on delete set null
    type        text not null    — login | note | file | env_var | card
    name        text not null    — plaintext label, e.g. "GitHub token"
    ciphertext  text not null    — base64 AES-GCM encrypted JSON payload
    iv          text not null    — base64 12-byte nonce
    created_by  uuid references users(id)
    created_at  timestamp default now()
    updated_at  timestamp default now()

  tags
    id       uuid primary key default gen_random_uuid()
    vault_id uuid references vaults(id) on delete cascade
    name     text not null
    colour   text
    unique(vault_id, name)

  secret_tags
    secret_id uuid references secrets(id) on delete cascade
    tag_id    uuid references tags(id) on delete cascade
    primary key(secret_id, tag_id)

  secret_versions
    id          uuid primary key default gen_random_uuid()
    secret_id   uuid references secrets(id) on delete cascade
    ciphertext  text not null
    iv          text not null
    created_by  uuid references users(id)
    created_at  timestamp default now()

Note: the ciphertext in secrets is a JSON payload encrypted as a whole. Different types have different JSON shapes — define those shapes as Zod schemas in @psst/types, not in the DB schema.

Generate and run migration.
```

### ✅ Session 2.5 — shared package + secret payload schemas — DONE (commit 0595d99)

```
Implement @psst/types.

File: packages/shared/src/secrets.ts

Define Zod schemas for the encrypted JSON payloads (decrypted client-side):

  LoginPayload
    username: string
    password: string
    url?: string
    totp_secret?: string
    notes?: string

  NotePayload
    content: string

  EnvVarPayload
    variables: Array<{ key: string; value: string }>
    project?: string
    environment?: string   — development | staging | production

  FilePayload
    filename: string
    mime_type: string
    size: number
    storage_key: string    — reference to object storage (the file itself is also encrypted)

  CardPayload
    number: string
    cardholder: string
    expiry: string
    cvv: string
    notes?: string

  SecretPayload = LoginPayload | NotePayload | EnvVarPayload | FilePayload | CardPayload

File: packages/shared/src/api.ts — API request/response schemas (fill in as tRPC is built)
File: packages/shared/src/index.ts — re-export everything

All schemas should be strict (no extra keys). Infer and export TypeScript types from Zod schemas.
```

---

## Phase 3 — server and tRPC

> Goal: running API server with auth endpoints. No frontend yet.

### ✅ Session 3.1 — server bootstrap — DONE (commit 08e0a56)

```
Bootstrap the server package.

Install: hono, @hono/node-server, @trpc/server, zod, dotenv, @psst/db, @psst/types

File: server/src/index.ts    — Hono app, listens on PORT env var
File: server/src/trpc.ts     — tRPC init, context type, base router
File: server/src/env.ts      — zod-validated environment variables:
  DATABASE_URL
  SESSION_SECRET          — 32+ char random string for signing
  PORT                    — default 3001
  CORS_ORIGIN             — web app URL

Context shape:
  db: DrizzleClient
  session: { userId: string; sessionId: string } | null

Middleware: attach session to context by reading Authorization: Bearer <token> header,
looking up token_hash (sha256 of token) in sessions table, checking expiry.

Add a GET /health endpoint (not tRPC) that returns { ok: true, db: "connected" }.
Dev script: tsx watch server/src/index.ts
```

### ✅ Session 3.2 — auth router (register + login) — DONE (commit 06f88bb)

```
Implement auth tRPC router.

File: server/src/routers/auth.ts

Procedures:

  auth.register
    Input (Zod):
      email: z.string().email()
      argon2Salt: z.string()             — base64, generated client-side
      encryptedVaultKey: z.string()      — base64
      vaultKeyIV: z.string()             — base64
      publicKey: z.string()              — base64
      encryptedPrivateKey: z.string()    — base64
      privateKeyIV: z.string()           — base64
      authHash: z.string()               — argon2id of password, computed client-side

    Logic:
      1. Check email not already registered
      2. Insert user + user_credentials row
      3. Create personal organisation for the user
      4. Generate session token (crypto.randomBytes(32)), hash it (sha256), insert sessions row
      5. Return: { sessionToken, userId, expiresAt }

    Note: server never sees the plaintext password — only the authHash (which is
    itself an argon2id hash). The client runs argon2id before sending.

  auth.login
    Input: email, authHash (client computes argon2id(password, argon2Salt) first)

    Wait — this needs the salt first. Split into two procedures:

  auth.getSalt
    Input: { email: string }
    Returns: { argon2Salt: string }   — needed by client to derive master key before login

  auth.login
    Input: { email: string; authHash: string }
    Logic:
      1. Look up user by email
      2. Verify authHash matches stored auth_hash (constant-time compare)
      3. Generate session token, insert sessions row
      4. Return: { sessionToken, userId, encryptedVaultKey, vaultKeyIV,
                   encryptedPrivateKey, privateKeyIV, publicKey, argon2Salt }

  auth.logout
    Protected (requires session). Deletes session row.

  auth.me
    Protected. Returns current user info + credentials (encrypted blobs only).

Wire the auth router into the main tRPC router.
Test with curl or a REST client — do not build frontend yet.
```

### ✅ Session 3.3 — vault router — DONE (commit 1a4d6b2)

```
Implement vault tRPC router.

File: server/src/routers/vaults.ts

All procedures are protected (require valid session).

Procedures:

  vault.list
    Returns all vaults the current user is a member of,
    including their encrypted_vault_key and vault_key_iv.

  vault.create
    Input:
      name: string
      organisationId: string
      encryptedVaultKey: string   — vault key encrypted with creator's master key
      vaultKeyIV: string

    Creates vault + vault_members row for the creator (role: owner).

  vault.get
    Input: { vaultId: string }
    Returns vault details + current user's encrypted_vault_key + members list.

  vault.invite
    Input:
      vaultId: string
      userId: string
      role: 'editor' | 'viewer'
      encryptedVaultKey: string   — vault key re-encrypted with recipient's public key (done client-side)
      vaultKeyIV: string

    Inserts vault_members row. The client must have already fetched the recipient's
    publicKey to perform the encryption.

  vault.removeMember
    Input: { vaultId: string; userId: string }
    Requires owner or admin role.

  vault.delete
    Input: { vaultId: string }
    Requires owner role. Cascades.

Wire into main router.
```

### ✅ Session 3.4 — secrets router — DONE (commit c4d068d)

```
Implement secrets tRPC router.

File: server/src/routers/secrets.ts

All procedures protected. Vault access checked on every call.

Procedures:

  secret.list
    Input: { vaultId: string; folderId?: string; type?: string; search?: string }
    Returns secrets metadata only (id, name, type, tags, folder, dates).
    Never returns ciphertext in list — only in secret.get.

  secret.get
    Input: { secretId: string }
    Returns full secret including ciphertext + iv.
    Client decrypts using vault key already in memory.

  secret.create
    Input:
      vaultId: string
      folderId?: string
      type: 'login' | 'note' | 'file' | 'env_var' | 'card'
      name: string
      ciphertext: string
      iv: string
      tagIds?: string[]

    Also inserts a secret_versions row with the same ciphertext (initial version).

  secret.update
    Input: { secretId: string; name?: string; ciphertext?: string; iv?: string; tagIds?: string[] }
    If ciphertext provided, appends to secret_versions before updating.

  secret.delete
    Input: { secretId: string }

  secret.versions
    Input: { secretId: string }
    Returns version history (ciphertext + iv for each version).

Wire into main router. Export the tRPC AppRouter type from server — this is what clients import for type safety.
```

### ✅ Session 3.5 — folders and tags routers — DONE (commit 2cfeeb6)

```
Implement folder and tag tRPC routers.

File: server/src/routers/folders.ts

  folder.list       — { vaultId } → folder tree (recursive CTE or flat + client builds tree)
  folder.create     — { vaultId, parentId?, name }
  folder.rename     — { folderId, name }
  folder.delete     — { folderId } — cascade handled by DB

File: server/src/routers/tags.ts

  tag.list          — { vaultId }
  tag.create        — { vaultId, name, colour? }
  tag.delete        — { tagId }
  tag.attach        — { secretId, tagId }
  tag.detach        — { secretId, tagId }

Wire both into main router.
```

### ✅ Session 3.6 — organisation router — DONE (commit 1042fca)

```
Implement organisation tRPC router.

File: server/src/routers/organisations.ts

  org.get           — { orgId } — returns org + members
  org.listMembers   — { orgId }
  org.invite        — { orgId, email, role } — creates an invitation (store in a simple invitations table)
  org.acceptInvite  — { token } — called when invited user registers or logs in
  org.removeMember  — { orgId, userId } — admin/owner only
  org.updateRole    — { orgId, userId, role }

Add invitations table to schema (Session 2.x follow-up):
  id          uuid primary key
  org_id      uuid references organisations(id)
  vault_id    uuid references vaults(id)  — optional
  email       text not null
  role        text not null
  token       text unique not null        — random token, sent in invite email
  invited_by  uuid references users(id)
  expires_at  timestamp
  accepted_at timestamp
  created_at  timestamp default now()

Wire into main router.
```

---

## Phase 4 — web app

> Goal: full web UI. Auth, vault management, secret CRUD, sharing.
> Build features in this order: auth → vault list → secret list → secret detail → sharing.

### ✅ Session 4.1 — web app bootstrap — DONE (commit ca7272b)

```
Bootstrap the web app (apps/web).

Install: react, react-dom, @vitejs/plugin-react, vite, typescript
Install: @tanstack/react-router, @tanstack/react-query
Install: @trpc/client, @trpc/react-query, @trpc/tanstack-react-query
Install: tailwindcss, @tailwindcss/vite, shadcn/ui (init)
Install: @psst/crypto, @psst/types, @psst/api (tRPC client)

File structure:
  apps/web/src/
    main.tsx            — React root, providers
    router.tsx          — TanStack Router route tree
    trpc.ts             — tRPC client, pointing to server URL
    routes/
      _auth/            — unauthenticated layout
        login.tsx
        register.tsx
      _app/             — authenticated layout (sidebar + header)
        index.tsx       — redirect to first vault
        vaults/
        settings/
    components/
      layout/
      ui/               — re-exports from @psst/ui

Session key in memory only — store the vault key and session token in a React context
(not localStorage, not sessionStorage). On page refresh, user must log in again.
This is correct zero-knowledge behaviour.

Add a KeyVaultContext:
  interface VaultSession {
    userId: string
    sessionToken: string
    masterKey: Uint8Array      — in memory only
    vaultKeys: Map<string, Uint8Array>   — vaultId → decrypted vault key
  }

Dev script: vite dev --port 3000
```

### ✅ Session 4.2 — register and login flows — DONE

```
Implement register and login UI in apps/web.

Route: /register
  Form fields: email, password, confirm password
  On submit:
    1. generateSalt() → argon2Salt
    2. deriveMasterKey(password, argon2Salt) → masterKey  [show loading spinner — this is slow]
    3. createVaultKey() → vaultKey
    4. wrapVaultKey(vaultKey, masterKey) → { encryptedVaultKey, vaultKeyIV }
    5. generateKeypair() → { publicKey, privateKey }
    6. wrapPrivateKey(privateKey, masterKey) → { encryptedPrivateKey, privateKeyIV }
    7. Compute authHash: argon2id(password, separateAuthSalt)  — use a DIFFERENT salt
    8. Call auth.register mutation with all the blobs
    9. On success: store { sessionToken, masterKey, vaultKey } in KeyVaultContext, redirect to /

Route: /login
  Form fields: email, password
  On submit:
    1. auth.getSalt({ email }) → argon2Salt
    2. deriveMasterKey(password, argon2Salt) → masterKey  [show loading]
    3. Compute authHash with stored auth salt (fetch separately or include in getSalt response)
    4. auth.login({ email, authHash }) → { sessionToken, encryptedVaultKey, vaultKeyIV, ... }
    5. unwrapVaultKey(encryptedVaultKey, masterKey, vaultKeyIV) → vaultKey
    6. Store in KeyVaultContext, redirect to /

Show clear error for wrong password (caught at unwrapVaultKey step).
Never show a technical error — just "incorrect email or password".
```

### ✅ Session 4.3 — vault list and creation — DONE

```
Implement vault list page and create vault modal.

Route: /_app/vaults
  Fetch vault.list
  For each vault: decrypt name is plaintext already (names are not encrypted)
  Show vault cards with: name, member count, secret count, last updated
  Button: "New vault"

Create vault modal:
  Input: vault name, organisation (dropdown of orgs user belongs to)
  On submit:
    1. Generate a new vault key (random 32 bytes)
    2. Wrap it with current user's master key → encryptedVaultKey
    3. vault.create mutation
    4. Store new vaultKey in KeyVaultContext.vaultKeys

Vault sidebar:
  List all vaults in left sidebar
  Active vault highlighted
  Click to navigate to vault
```

### ✅ Session 4.4 — secret list — DONE

```
Implement the secret list view inside a vault.

Route: /_app/vaults/$vaultId

Left panel: folder tree + tag filter list
Main panel: secret list

Secret list:
  Fetch secret.list({ vaultId, folderId?, type?, search? })
  Show: icon by type, name, type badge, tags, last updated
  No ciphertext fetched in list view
  Search bar filters by name (server-side)
  Type filter tabs: All | Logins | Notes | Env vars | Files | Cards
  Tag filter: multi-select sidebar chips

Click a secret → open detail panel (next session)

Empty state per type: "No logins yet — add your first one"
```

### ✅ Session 4.5 — secret detail and edit — DONE

```
Implement secret detail panel and edit forms.

Panel opens on right when a secret is clicked.
Fetch secret.get({ secretId }) → gets ciphertext + iv.
Decrypt: decryptSecret(ciphertext, vaultKey, iv) → JSON → parse with Zod schema for type.

Display forms per type:

  Login:
    URL (clickable link), username (copy button), password (masked + reveal toggle + copy),
    TOTP secret (show live 6-digit code if present), notes

  Note:
    Rendered markdown (use react-markdown)

  Env var:
    Table of KEY=VALUE pairs, each value masked + copyable
    "Copy all as .env" button → copies KEY=VALUE\n... to clipboard

  File:
    Filename, size, download button (fetches from storage, decrypts client-side)

  Card:
    Number (masked), cardholder, expiry, CVV (masked + reveal)

Edit mode:
  Each type has its own edit form
  On save:
    1. Serialize to JSON → encrypt with vault key → new IV each time
    2. secret.update mutation
    3. Optimistic UI update

Create flow ("+" button in list):
  Type picker first → then type-specific creation form
  Same encryption flow as update
```

### ✅ Session 4.6 — folders and tags UI — DONE

```
Implement folder management and tag management in the web app.

Folder tree in left sidebar:
  Nested list, expand/collapse
  Right-click context menu: rename, delete, new subfolder
  Drag secret into folder (update secret's folderId)
  "New folder" button at top of tree

Tag management:
  Settings page: /vaults/$vaultId/settings/tags
  List tags, create tag (name + colour picker), delete tag
  Tag chips in secret list are clickable filters

Folder creation/rename: inline editing (click label → input appears)
```

### ✅ Session 4.7 — vault sharing and member management — DONE

```
Implement vault member management and the invite flow.

Route: /_app/vaults/$vaultId/settings/members

Member list:
  Show all vault members with name, email, role, granted date
  Role change dropdown (owner/admin only)
  Remove member button

Invite flow:
  Input: email or username
  On submit:
    1. Fetch recipient's publicKey via a new user.getPublicKey({ email }) procedure
    2. Get current user's vaultKey from KeyVaultContext
    3. encryptVaultKeyForRecipient(vaultKey, recipientPublicKey, myPrivateKey) → { ciphertext, iv }
       — requires unwrapping myPrivateKey first: unwrapPrivateKey(encryptedPrivateKey, masterKey, privateKeyIV)
    4. vault.invite({ vaultId, userId, role, encryptedVaultKey: ciphertext, vaultKeyIV: iv })

Add user.getPublicKey tRPC procedure on the server (returns publicKey for any registered email).

When an invited user logs in:
  Check for pending vault invites (new query in auth.me or vault.list)
  Accept automatically or show "You've been invited to X vault" prompt
  On accept: the encrypted vault key is already there (was encrypted for them at invite time)
  Just unwrap it with their private key: decryptVaultKeyFromSender(...)
  Store in KeyVaultContext
```

### ✅ Session 4.8 — organisation management — DONE

```
Implement organisation management pages.

Route: /settings/organisation

  Members tab:
    List org members, roles
    Invite by email (sends email with invite token — use Resend or just log to console in dev)
    Remove member, change role

  Vaults tab:
    List vaults in this org, create new vault

Route: /settings/profile
  Change email (requires re-auth)
  Change password:
    1. Derive new masterKey from new password
    2. Re-wrap vault key and private key with new masterKey
    3. Compute new authHash
    4. Single API call to update all three
  Delete account

Route: /settings (root, redirect to /settings/profile)
```

### ✅ Session 4.9 — polish and UX — DONE

```
Polish pass on the web app before moving to CLI.

Items:
  - Add keyboard shortcuts: Ctrl+K → command palette (search all secrets across all vaults)
  - Clipboard auto-clear: after copying a password, clear clipboard after 30 seconds (show countdown)
  - Idle lock: after 15 minutes of inactivity, clear KeyVaultContext (user must re-enter password)
    Configurable in settings.
  - Session expiry handling: when tRPC returns 401, clear context and redirect to /login
  - Loading states: all mutations show loading state, success/error toasts
  - Empty states: every list has a helpful empty state with a call to action
  - Responsive layout: test at 768px (tablet) — sidebar collapses to drawer
  - Password strength indicator on register and on login creation form
  - Favicon and page title per route
  - Error boundary at route level
```

---

## Phase 5 — CLI

> Goal: a CLI tool for developers to use env vars in local development and CI/CD.

### ✅ Session 5.1 — CLI scaffold — DONE

```
Scaffold the CLI app (apps/cli).

Install: commander, @trpc/client, node-fetch, keytar, dotenv, @psst/crypto, @psst/types
Install dev: tsup (build), tsx (dev)

File structure:
  apps/cli/src/
    index.ts          — entry point, registers commands
    commands/
      login.ts
      logout.ts
      env.ts          — env var commands
      secret.ts       — general secret commands
    lib/
      auth.ts         — session management (keytar for OS keychain)
      api.ts          — tRPC client
      crypto.ts       — re-exports from @psst/crypto, handles key material in memory
      config.ts       — reads ~/.vault/config.json for server URL, org, etc.

Build output: dist/index.js, add shebang, publish bin as vault.

keytar stores:
  - session token → OS keychain (vault/sessionToken)
  - master key → OS keychain (vault/masterKey)  — so user stays logged in across CLI invocations

Config file (~/.vault/config.json):
  { "serverUrl": "https://...", "defaultOrgId": "...", "defaultVaultId": "..." }
```

### ✅ Session 5.2 — CLI auth commands — DONE

```
Implement vault login and vault logout.

vault login
  Prompts: server URL (if not in config), email, password
  Performs same client-side key derivation as web app
  Calls auth.getSalt → deriveMasterKey → auth.login
  Stores sessionToken in OS keychain
  Stores masterKey in OS keychain (base64 encoded)
  Stores encryptedVaultKey + vaultKeyIV + encryptedPrivateKey + privateKeyIV in config file
  Prints: "Logged in as user@example.com"

vault logout
  Clears keychain entries
  Calls auth.logout on server
  Prints: "Logged out"

vault whoami
  Reads session from keychain
  Calls auth.me
  Prints: email, userId, orgs, vaults

On any CLI command: if keychain has sessionToken but no masterKey, prompt for password
and re-derive (don't ask for password on every command if keychain works).
```

### ✅ Session 5.3 — env var commands — DONE

```
Implement env var commands — the primary CLI use case.

vault env pull [--vault <id>] [--env <development|staging|production>] [--project <name>] [--output .env]
  1. Fetches secrets of type env_var from the specified vault
  2. Filters by project and environment if provided
  3. Decrypts each secret client-side
  4. Writes KEY=VALUE pairs to .env file (default) or stdout (--stdout flag)
  Example: vault env pull --env production --output .env.production

vault env push [--vault <id>] [--env <development>] [--project <name>] [--input .env]
  1. Reads KEY=VALUE pairs from .env file
  2. Groups into one EnvVarPayload JSON
  3. Encrypts with vault key
  4. Creates or updates the secret (match by project + environment name)
  Example: vault env push --env development --input .env.local

vault env list [--vault <id>]
  Lists env_var secrets (names only, not values) in table format

vault env run -- <command>
  Pulls env vars for current project + environment into process.env
  Then executes the command
  Example: vault env run -- npm run dev
  Reads project from .vault in current directory or --project flag

vault env init
  Interactive: choose vault, project name, environment
  Writes .vault file to current directory: { vaultId, project, environment }
  Add .vault to .gitignore automatically if git repo detected

CI/CD usage (non-interactive):
  VAULT_SESSION_TOKEN and VAULT_MASTER_KEY env vars override keychain
  Allows use in CI: export VAULT_SESSION_TOKEN=$(vault token export)

vault token export
  Prints sessionToken to stdout (for CI use)
  Prints masterKey to stdout as base64 (for CI use)
  Warn: "This exposes your master key — only use in trusted CI environments"
```

### Session 5.4 — general secret commands

```
Implement general secret management commands.

vault secret list [--vault <id>] [--type login|note|env_var] [--folder <name>]
  Table output: ID (truncated), name, type, last updated

vault secret get <name-or-id> [--vault <id>] [--field username|password|url]
  Fetches and decrypts a secret
  Default: prints all fields (password masked)
  --field: prints just that field value to stdout (for scripting)
  --reveal: unmask passwords in output
  Example: vault secret get "GitHub" --field password | pbcopy

vault secret create [--vault <id>] [--type login|note|env_var]
  Interactive prompts per type

vault secret delete <name-or-id> [--vault <id>]
  Confirmation prompt

vault vault list
  Lists all vaults current user has access to

vault vault use <vault-id-or-name>
  Sets default vault in config
```

---

## Deferring to later

These are explicitly out of scope until Phase 5 is done and the core loop works:

- **Desktop app (Tauri)** — the web app in a native shell; most work is Tauri config and OS keychain integration. Start after web is stable.
- **Browser extensions (WXT)** — autofill is the main value-add. Start after desktop.
- **Mobile (Expo)** — React Native shares tRPC types; UI is largely independent. Start after extension.
- **File storage** — implement S3/R2 integration when file secrets are needed.
- **Email sending** — use Resend; wire it up when invite emails are needed (currently log to console).
- **Audit log** — append-only log of who accessed what, when. Add once team features are in use.
- **Emergency kit** — PDF with recovery instructions and account key. Post-MVP.

---

## How to run each session with Claude Code

```bash
# Start a session with the content of each session block above.
# Example for Session 1.1:
claude "Implement packages/crypto/src/primitives.ts with these exact functions: ..."

# Review the output, run the tests, commit.
git add -A && git commit -m "feat(crypto): primitive encrypt/decrypt with argon2id key derivation"

# Then start the next session.
claude "Now implement packages/crypto/src/vault.ts ..."
```

Keep each session focused. If Claude Code starts touching files outside the session scope, redirect it.
After each session: `pnpm turbo typecheck && pnpm turbo test` from root. Zero errors before next session.

---

## Environment setup before starting

```bash
# Prerequisites
node >= 20
pnpm >= 9
postgres (local — use Docker: docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16)
rust + cargo (for Tauri, defer until Phase 6)

# After Phase 0
cp .env.example .env
# Fill in DATABASE_URL, SESSION_SECRET

# After Phase 2
cd packages/db && pnpm db:migrate
```
