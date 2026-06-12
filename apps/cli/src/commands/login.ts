/**
 * silo login   — authenticate and persist session to ~/.silo/credentials.json
 * silo logout  — clear the session
 * silo whoami  — print current user info (email, orgs, vaults)
 */

import { Command } from 'commander';
import { deriveMasterKey, fromBase64, toBase64, unwrapVaultKey, wrapVaultKey } from '@silo/crypto';
import { getApiClient, resetApiClient } from '../lib/api';
import { saveSession, destroySession, requireSession } from '../lib/auth';
import { readConfig, writeConfig, getServerUrl } from '../lib/config';
import { promptInput, promptPassword } from '../lib/prompt';

const DEFAULT_SERVER_URL = 'http://localhost:3001';

// ── Helper: parse combined salt field ────────────────────────────────────────

function parseSaltField(argon2SaltFull: string): {
  masterSalt: Uint8Array;
  authSalt: Uint8Array;
} {
  const decoded = JSON.parse(new TextDecoder().decode(fromBase64(argon2SaltFull))) as {
    masterSalt: string;
    authSalt: string;
  };
  return {
    masterSalt: fromBase64(decoded.masterSalt),
    authSalt: fromBase64(decoded.authSalt),
  };
}

// ── login ─────────────────────────────────────────────────────────────────────

export function makeLoginCommand(): Command {
  return new Command('login')
    .description('Authenticate with the Silo server and save session locally')
    .option('--server <url>', 'Override server URL for this session')
    .action(async (options: { server?: string }) => {
      try {
        // ── 1. Resolve server URL ─────────────────────────────────────────────
        if (options.server) {
          // Explicit flag always wins — save it
          const config = readConfig();
          writeConfig({ ...config, serverUrl: options.server });
        } else {
          // Prompt interactively if still pointing at localhost (unconfigured)
          const config = readConfig();
          if (!config.serverUrl || config.serverUrl === DEFAULT_SERVER_URL) {
            const input = await promptInput(
              `Server URL [${DEFAULT_SERVER_URL}]: `,
            );
            const url = input.trim() || DEFAULT_SERVER_URL;
            if (url !== DEFAULT_SERVER_URL) {
              writeConfig({ ...config, serverUrl: url });
            }
          }
        }

        const serverUrl = getServerUrl();
        console.log(`Connecting to ${serverUrl}`);

        // ── 2. Collect credentials ────────────────────────────────────────────
        const email = await promptInput('Email: ');
        const password = await promptPassword('Master password: ');

        const api = getApiClient();

        // ── 3. Fetch argon2 salt ──────────────────────────────────────────────
        process.stdout.write('Deriving keys… ');
        const { argon2Salt: argon2SaltFull } = await api.auth.getSalt.query({ email });

        // ── 4. Derive master key + auth hash ──────────────────────────────────
        const { masterSalt, authSalt } = parseSaltField(argon2SaltFull);
        const masterKey = deriveMasterKey(password, masterSalt);
        const authKey = deriveMasterKey(`auth:${password}`, authSalt);
        const authHash = toBase64(authKey);
        process.stdout.write('done\n');

        // ── 5. Authenticate ───────────────────────────────────────────────────
        process.stdout.write('Authenticating… ');
        let result = await api.auth.login.mutate({ email, authHash });
        process.stdout.write('done\n');

        // Step-up verification (new device, stale session, or 2FA) ─────────────
        if (result.challengeRequired) {
          const code = await promptInput('Verification code: ');
          result = await api.auth.verifyLoginChallenge.mutate({
            challengeId: result.challengeId,
            code: code.trim(),
          });
        }

        if (result.challengeRequired) {
          throw new Error('Unexpected challenge response');
        }

        // ── 6. Save minimal session so next API calls are authenticated ───────
        saveSession({
          sessionToken: result.sessionToken,
          masterKey: toBase64(masterKey),
          encryptedPrivateKey: result.encryptedPrivateKey,
          privateKeyIv: result.privateKeyIv,
          publicKey: result.publicKey,
          vaultKeys: {},
          email,
          userId: result.userId,
        });

        // Reset API client so it picks up the new session token from credentials
        resetApiClient();
        const authedApi = getApiClient();

        // ── 7. Fetch all active vault memberships, cache decrypted vault keys ─
        process.stdout.write('Loading vaults… ');
        const vaults = await authedApi.vault.list.query();
        const vaultKeyCache: Record<string, { encryptedVaultKey: string; vaultKeyIv: string }> = {};

        for (const vault of vaults) {
          try {
            const vaultKey = unwrapVaultKey(
              fromBase64(vault.encryptedVaultKey),
              masterKey,
              fromBase64(vault.vaultKeyIv),
            );
            const { encryptedVaultKey: rewrapped, iv } = wrapVaultKey(vaultKey, masterKey);
            vaultKeyCache[vault.id] = {
              encryptedVaultKey: toBase64(rewrapped),
              vaultKeyIv: toBase64(iv),
            };
          } catch {
            // Skip vaults whose keys can't be unwrapped (shouldn't happen on active memberships)
          }
        }
        process.stdout.write('done\n');

        // ── 8. Persist complete session ───────────────────────────────────────
        saveSession({
          sessionToken: result.sessionToken,
          masterKey: toBase64(masterKey),
          encryptedPrivateKey: result.encryptedPrivateKey,
          privateKeyIv: result.privateKeyIv,
          publicKey: result.publicKey,
          vaultKeys: vaultKeyCache,
          email,
          userId: result.userId,
        });

        console.log(`\nLogged in as ${email}`);
        if (vaults.length > 0) {
          console.log(`${vaults.length} vault${vaults.length !== 1 ? 's' : ''} loaded.`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'Interrupted') {
          console.log('\nCancelled.');
          process.exit(0);
        }
        console.error(`\nLogin failed: ${message}`);
        process.exit(1);
      }
    });
}

// ── logout ────────────────────────────────────────────────────────────────────

export function makeLogoutCommand(): Command {
  return new Command('logout')
    .description('Clear the saved session')
    .action(async () => {
      try {
        const api = getApiClient();
        await api.auth.logout.mutate().catch(() => {
          // Ignore server error — clear local session regardless
        });
      } finally {
        destroySession();
        console.log('Logged out.');
      }
    });
}

// ── whoami ────────────────────────────────────────────────────────────────────

export function makeWhoamiCommand(): Command {
  return new Command('whoami')
    .description('Print current user info (email, organisations, vaults)')
    .action(async () => {
      const session = requireSession();
      const api = getApiClient();

      try {
        // Fetch user info + org/vault lists in parallel
        const [me, orgs, vaults] = await Promise.all([
          api.auth.me.query(),
          api.org.list.query(),
          api.vault.list.query(),
        ]);

        console.log(`Email:   ${me.email}`);
        console.log(`User ID: ${me.id}`);

        if (orgs.length > 0) {
          console.log('\nOrganisations:');
          for (const o of orgs) {
            console.log(`  ${o.name} (${o.slug}) — ${o.role}`);
          }
        } else {
          console.log('\nNo organisations.');
        }

        if (vaults.length > 0) {
          console.log('\nVaults:');
          for (const v of vaults) {
            const secretLabel = `${v.secretCount} secret${v.secretCount !== 1 ? 's' : ''}`;
            console.log(`  ${v.name.padEnd(36)}  ${v.role.padEnd(8)}  [${secretLabel}]`);
          }
        } else {
          console.log('\nNo vaults.');
        }
      } catch {
        // Fallback to local credentials when server is unreachable
        console.log(`Email:   ${session.email || '(unknown)'}`);
        console.log(`User ID: ${session.userId || '(unknown)'}`);
        console.log(`\n(Could not reach server — showing cached info)`);
      }
    });
}
