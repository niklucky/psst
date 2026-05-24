/**
 * CLI crypto helpers — thin re-exports from @psst/crypto, plus
 * key-material helpers specific to the CLI session lifecycle.
 *
 * The CLI keeps the masterKey in the credentials file (base64) so the
 * user does not have to re-enter their password on every command.
 * In CI/CD the PSST_MASTER_KEY env var can override this.
 */

export {
  deriveMasterKey,
  createVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  encryptSecret,
  decryptSecret,
  generateKeypair,
  wrapPrivateKey,
  unwrapPrivateKey,
  encryptVaultKeyForRecipient,
  decryptVaultKeyFromSender,
  toBase64,
  fromBase64,
  generateSalt,
  textToBytes,
  bytesToText,
} from '@psst/crypto';

import { fromBase64, unwrapVaultKey } from '@psst/crypto';
import { readCredentials } from './config';

/** Returns the master key bytes from credentials file or CI env var. */
export function getMasterKeyBytes(): Uint8Array | null {
  const fromEnv = process.env['PSST_MASTER_KEY'];
  if (fromEnv) return fromBase64(fromEnv);
  const creds = readCredentials();
  if (!creds) return null;
  return fromBase64(creds.masterKey);
}

/** Returns all vault keys from the credentials file, keyed by vaultId. */
export function getVaultKeysMap(): Map<string, Uint8Array> {
  const creds = readCredentials();
  if (!creds) return new Map();
  const masterKey = getMasterKeyBytes();
  if (!masterKey) return new Map();

  const map = new Map<string, Uint8Array>();
  for (const [vaultId, { encryptedVaultKey, vaultKeyIv }] of Object.entries(creds.vaultKeys)) {
    try {
      map.set(vaultId, unwrapVaultKey(fromBase64(encryptedVaultKey), masterKey, fromBase64(vaultKeyIv)));
    } catch {
      // Corrupted entry — skip
    }
  }
  return map;
}
