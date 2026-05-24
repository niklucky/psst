/**
 * Session helpers for the CLI.
 *
 * Wraps credential file read/write with higher-level helpers used by commands.
 */

import fs from 'node:fs';
import { deriveMasterKey, fromBase64, toBase64 } from '@psst/crypto';
import { readCredentials, writeCredentials, clearCredentials, readConfig, writeConfig } from './config';
import type { PsstCredentials } from './config';
import { promptPassword } from './prompt';

export { readCredentials, writeCredentials, clearCredentials };

/**
 * Returns the current session, or null if not logged in.
 * Checks both credential file and CI env vars.
 */
export function getSession(): PsstCredentials | null {
  // CI/CD: env vars can fully substitute credentials
  if (process.env['PSST_SESSION_TOKEN'] && process.env['PSST_MASTER_KEY']) {
    // Minimal synthetic session — commands that need vault keys will fail gracefully
    return {
      sessionToken: process.env['PSST_SESSION_TOKEN'],
      masterKey: process.env['PSST_MASTER_KEY'],
      encryptedPrivateKey: '',
      privateKeyIv: '',
      publicKey: '',
      vaultKeys: {},
      email: '',
      userId: '',
    };
  }
  return readCredentials();
}

/**
 * Asserts that the user is logged in.
 * Prints an error and exits if not.
 */
export function requireSession(): PsstCredentials {
  const session = getSession();
  if (!session) {
    console.error('Not logged in. Run `psst login` first.');
    process.exit(1);
  }
  return session;
}

/**
 * Returns the master key bytes for the given session.
 *
 * If the session was created with CI env vars (PSST_MASTER_KEY) or normally (file),
 * it just decodes from base64. If the stored masterKey is missing (e.g. manually
 * removed), re-derives it from the user's password.
 */
export async function requireMasterKey(session: PsstCredentials): Promise<Uint8Array> {
  if (session.masterKey) {
    return fromBase64(session.masterKey);
  }

  // masterKey is missing — prompt to re-derive
  console.error('Master key not found in session. Re-derivation required.');

  if (!session.email) {
    console.error('Cannot re-derive: email not in session. Please run `psst login` again.');
    process.exit(1);
  }

  const password = await promptPassword('Master password: ');

  // Import api client lazily to avoid circular deps at module load
  const { getApiClient } = await import('./api');
  const api = getApiClient();

  const { argon2Salt: argon2SaltFull } = await api.auth.getSalt.query({ email: session.email });
  const decoded = JSON.parse(
    new TextDecoder().decode(fromBase64(argon2SaltFull)),
  ) as { masterSalt: string };

  const masterKey = deriveMasterKey(password, fromBase64(decoded.masterSalt));

  // Persist the recovered masterKey
  const creds = readCredentials();
  if (creds) {
    writeCredentials({ ...creds, masterKey: toBase64(masterKey) });
  }

  return masterKey;
}

/**
 * Saves a session after successful login.
 */
export function saveSession(creds: PsstCredentials): void {
  writeCredentials(creds);
}

/**
 * Clears the current session (logout).
 */
export function destroySession(): void {
  clearCredentials();
}

/**
 * Updates just the vault keys in the saved session (e.g. after accepting an invite).
 */
export function updateVaultKeys(
  vaultKeys: Record<string, { encryptedVaultKey: string; vaultKeyIv: string }>,
): void {
  const creds = readCredentials();
  if (!creds) return;
  writeCredentials({ ...creds, vaultKeys: { ...creds.vaultKeys, ...vaultKeys } });
}

/**
 * Returns the configured default vault ID from .psst (project-local) or global config.
 */
export function getDefaultVaultId(): string | undefined {
  // Check project-local .psst file first
  try {
    const raw = fs.readFileSync('.psst', 'utf8');
    const local = JSON.parse(raw) as { vaultId?: string };
    if (local.vaultId) return local.vaultId;
  } catch {
    // no .psst file — fall through to global config
  }
  return readConfig().defaultVaultId;
}

/**
 * Sets the default vault ID in the global config.
 */
export function setDefaultVaultId(vaultId: string): void {
  const config = readConfig();
  writeConfig({ ...config, defaultVaultId: vaultId });
}
