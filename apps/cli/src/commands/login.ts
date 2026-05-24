/**
 * psst login   — authenticate and persist session to ~/.psst/credentials.json
 * psst logout  — clear the session
 * psst whoami  — print current user info
 */

import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { deriveMasterKey, fromBase64, toBase64, unwrapVaultKey, wrapVaultKey } from '@psst/crypto';
import { getApiClient, resetApiClient } from '../lib/api';
import { saveSession, destroySession, requireSession } from '../lib/auth';
import { readConfig, writeConfig, getServerUrl } from '../lib/config';

// ── Helper: prompt securely ───────────────────────────────────────────────────

async function prompt(question: string, mask = false): Promise<string> {
  const rl = readline.createInterface({ input, output });

  if (mask) {
    // Hide input on TTY
    if (process.stdin.isTTY) {
      output.write(question);
      await new Promise<void>((resolve) => {
        process.stdin.setRawMode(true);
        let value = '';
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        const onData = (ch: string) => {
          if (ch === '') process.exit(); // Ctrl-C
          if (ch === '\r' || ch === '\n') {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            output.write('\n');
            // Store in a closure — we resolve via returning the value
            resolve();
            // Sneak the value back (hacky but works for simple cases)
            (prompt as unknown as { _last: string })._last = value;
          } else if (ch === '') {
            value = value.slice(0, -1);
          } else {
            value += ch;
          }
        };
        process.stdin.on('data', onData);
      });
      rl.close();
      return (prompt as unknown as { _last: string })._last ?? '';
    }
  }

  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

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
    .description('Authenticate with the Psst server and save session locally')
    .option('--server <url>', 'Override server URL')
    .action(async (options: { server?: string }) => {
      try {
        // Allow server URL override
        if (options.server) {
          const config = readConfig();
          writeConfig({ ...config, serverUrl: options.server });
        }

        const serverUrl = getServerUrl();
        console.log(`Connecting to ${serverUrl}`);

        const email = await prompt('Email: ');
        const password = await prompt('Master password: ', true);

        const api = getApiClient();

        // 1. Fetch argon2 salt
        process.stdout.write('Deriving keys… ');
        const { argon2Salt: argon2SaltFull } = await api.auth.getSalt.query({ email });

        // 2. Parse and derive master key
        const { masterSalt, authSalt } = parseSaltField(argon2SaltFull);
        const masterKey = deriveMasterKey(password, masterSalt);

        // 3. Compute auth hash
        const authKey = deriveMasterKey(`auth:${password}`, authSalt);
        const authHash = toBase64(authKey);

        process.stdout.write('done\n');
        process.stdout.write('Authenticating… ');

        // 4. Login — server verifies authHash, returns encrypted blobs
        const result = await api.auth.login.mutate({ email, authHash });

        process.stdout.write('done\n');

        // 5. Unwrap + re-wrap all active vault keys with master key
        // result.encryptedVaultKey is for the default vault; we store all of them
        // by fetching the vault list after login
        const vaultKeyWrapped: Record<string, { encryptedVaultKey: string; vaultKeyIv: string }> = {};

        // Store session token first, then fetch all vaults
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

        // Reset API client to pick up the new session token
        resetApiClient();
        const authedApi = getApiClient();

        // 6. Fetch all active vault memberships and unwrap/re-wrap each vault key
        const vaults = await authedApi.vault.list.query();
        for (const vault of vaults) {
          try {
            const vaultKey = unwrapVaultKey(
              fromBase64(vault.encryptedVaultKey),
              masterKey,
              fromBase64(vault.vaultKeyIv),
            );
            const { encryptedVaultKey: rewrapped, iv } = wrapVaultKey(vaultKey, masterKey);
            vaultKeyWrapped[vault.id] = {
              encryptedVaultKey: toBase64(rewrapped),
              vaultKeyIv: toBase64(iv),
            };
          } catch {
            // Skip vaults we can't unwrap — shouldn't happen for active memberships
          }
        }

        // 7. Persist full credentials
        saveSession({
          sessionToken: result.sessionToken,
          masterKey: toBase64(masterKey),
          encryptedPrivateKey: result.encryptedPrivateKey,
          privateKeyIv: result.privateKeyIv,
          publicKey: result.publicKey,
          vaultKeys: vaultKeyWrapped,
          email,
          userId: result.userId,
        });

        console.log(`\nLogged in as ${email}`);
        console.log(`Session saved to ~/.psst/credentials.json`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Login failed: ${message}`);
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
    .description('Print current user info')
    .action(async () => {
      const session = requireSession();
      try {
        const api = getApiClient();
        const me = await api.auth.me.query();
        console.log(`Email:   ${me.email}`);
        console.log(`User ID: ${me.id}`);
      } catch {
        // Fallback to local credentials
        console.log(`Email:   ${session.email || '(unknown)'}`);
        console.log(`User ID: ${session.userId || '(unknown)'}`);
        console.log(`(Could not reach server — showing cached info)`);
      }
    });
}
