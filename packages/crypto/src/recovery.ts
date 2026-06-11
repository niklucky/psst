import { randomBytes } from '@noble/hashes/utils.js';
import { decrypt, encrypt } from './primitives';
import { toHex } from './encoding';

/**
 * Recovery code length in bytes. 16 bytes = 128 bits of entropy — high enough
 * that the `wrappedMasterKey`/`recoverySalt` blob the server hands out during
 * recovery can't be brute-forced offline (argon2id over a 128-bit secret).
 */
const RECOVERY_CODE_BYTES = 16;

/**
 * Generates a high-entropy recovery code, formatted as dash-separated groups of
 * four hex characters for readability (e.g. `a1b2-c3d4-…`). Shown to the user
 * once; never stored in plaintext anywhere. Derivation always normalizes first
 * (see {@link normalizeRecoveryCode}) so the grouping is purely cosmetic.
 */
export function generateRecoveryCode(): string {
  const hex = toHex(randomBytes(RECOVERY_CODE_BYTES));
  return (hex.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Normalizes a recovery code for key derivation: strips formatting (dashes,
 * spaces) and lowercases, so the code derives the same key regardless of how
 * the user typed it back in.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Wraps (encrypts) the master key under a recovery-code-derived key for storage.
 * Mirrors {@link wrapVaultKey} — same primitive, named for the recovery flow.
 */
export function wrapMasterKey(
  masterKey: Uint8Array,
  recoveryKey: Uint8Array,
): { wrappedMasterKey: Uint8Array; iv: Uint8Array } {
  const { ciphertext: wrappedMasterKey, iv } = encrypt(masterKey, recoveryKey);
  return { wrappedMasterKey, iv };
}

/**
 * Unwraps (decrypts) the master key using a recovery-code-derived key.
 * Throws if the recovery code (and therefore the derived key) is wrong.
 */
export function unwrapMasterKey(
  wrappedMasterKey: Uint8Array,
  recoveryKey: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  return decrypt(wrappedMasterKey, recoveryKey, iv);
}
