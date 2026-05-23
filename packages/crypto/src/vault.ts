import { decrypt, encrypt, generateKey } from './primitives';

/**
 * Generates a random 32-byte vault key.
 */
export function createVaultKey(): Uint8Array {
  return generateKey();
}

/**
 * Wraps (encrypts) a vault key with a master key for storage.
 */
export function wrapVaultKey(
  vaultKey: Uint8Array,
  masterKey: Uint8Array,
): { encryptedVaultKey: Uint8Array; iv: Uint8Array } {
  const { ciphertext: encryptedVaultKey, iv } = encrypt(vaultKey, masterKey);
  return { encryptedVaultKey, iv };
}

/**
 * Unwraps (decrypts) a vault key using the master key.
 * Throws if the master key is wrong.
 */
export function unwrapVaultKey(
  encryptedVaultKey: Uint8Array,
  masterKey: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  return decrypt(encryptedVaultKey, masterKey, iv);
}

/**
 * Encrypts a plaintext string secret using the vault key.
 * UTF-8 encodes the string, then AES-256-GCM encrypts it.
 * A fresh random IV is used every call.
 */
export function encryptSecret(
  plaintext: string,
  vaultKey: Uint8Array,
): { ciphertext: Uint8Array; iv: Uint8Array } {
  const bytes = new TextEncoder().encode(plaintext);
  const { ciphertext, iv } = encrypt(bytes, vaultKey);
  return { ciphertext, iv };
}

/**
 * Decrypts a ciphertext secret and returns the plaintext string.
 */
export function decryptSecret(
  ciphertext: Uint8Array,
  vaultKey: Uint8Array,
  iv: Uint8Array,
): string {
  const bytes = decrypt(ciphertext, vaultKey, iv);
  return new TextDecoder().decode(bytes);
}
