/**
 * Session helpers for the CLI.
 *
 * Wraps credential file read/write with higher-level helpers used by commands.
 */

import fs from 'node:fs';
import { readCredentials, writeCredentials, clearCredentials, readConfig, writeConfig } from './config';
import type { PsstCredentials } from './config';

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
