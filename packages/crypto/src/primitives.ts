import { gcm } from '@noble/ciphers/aes.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from '@noble/hashes/utils.js';

/**
 * Generates a random 16-byte salt.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(16);
}

/**
 * Generates a random 32-byte symmetric key.
 */
export function generateKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Generates a random 12-byte IV/nonce for AES-256-GCM.
 */
export function generateIV(): Uint8Array {
  return randomBytes(12);
}

/**
 * Derives a 32-byte master key from a password and salt using argon2id.
 * Parameters: m=65536 (64 MiB), t=3 iterations, p=4 parallelism, dkLen=32.
 */
export function deriveMasterKey(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, { m: 65536, t: 3, p: 4, dkLen: 32 });
}

/**
 * Encrypts plaintext bytes using AES-256-GCM.
 * Generates a fresh random IV on every call.
 */
export function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
): { ciphertext: Uint8Array; iv: Uint8Array } {
  const iv = generateIV();
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintext);
  return { ciphertext, iv };
}

/**
 * Decrypts ciphertext bytes using AES-256-GCM.
 * Throws if the authentication tag is invalid (wrong key or IV, or tampered data).
 */
export function decrypt(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const cipher = gcm(key, iv);
  return cipher.decrypt(ciphertext);
}
