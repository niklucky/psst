/**
 * CLI configuration — reads/writes ~/.psst/config.json
 *
 * Stores non-secret config: server URL, default org/vault.
 * Encrypted credentials (session token, master key, wrapped vault keys)
 * are stored in ~/.psst/credentials.json (chmod 600).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PSST_DIR = path.join(os.homedir(), '.psst');
const CONFIG_FILE = path.join(PSST_DIR, 'config.json');
const CREDENTIALS_FILE = path.join(PSST_DIR, 'credentials.json');

export interface PsstConfig {
  serverUrl: string;
  defaultOrgId?: string;
  defaultVaultId?: string;
}

export interface PsstCredentials {
  sessionToken: string;
  /** base64-encoded master key (kept in memory during a session, persisted for CLI) */
  masterKey: string;
  /** base64-encoded encrypted private key (stored server-side too, but cached here) */
  encryptedPrivateKey: string;
  privateKeyIv: string;
  /** base64-encoded public key */
  publicKey: string;
  /** Wrapped vault keys, keyed by vaultId */
  vaultKeys: Record<string, { encryptedVaultKey: string; vaultKeyIv: string }>;
  email: string;
  userId: string;
}

const DEFAULT_SERVER_URL = 'http://localhost:3001';

function ensureDir(): void {
  if (!fs.existsSync(PSST_DIR)) {
    fs.mkdirSync(PSST_DIR, { recursive: true, mode: 0o700 });
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export function readConfig(): PsstConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw) as PsstConfig;
  } catch {
    return { serverUrl: DEFAULT_SERVER_URL };
  }
}

export function writeConfig(config: PsstConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

// ── Credentials ───────────────────────────────────────────────────────────────

export function readCredentials(): PsstCredentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    return JSON.parse(raw) as PsstCredentials;
  } catch {
    return null;
  }
}

export function writeCredentials(creds: PsstCredentials): void {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // already gone — fine
  }
}

export function getServerUrl(): string {
  // Environment variable always wins (CI/CD)
  return process.env['PSST_SERVER_URL'] ?? readConfig().serverUrl ?? DEFAULT_SERVER_URL;
}

/** Full path to the config directory */
export const PSST_CONFIG_DIR = PSST_DIR;
