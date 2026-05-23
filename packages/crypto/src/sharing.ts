import { x25519 } from '@noble/curves/ed25519.js';
import { decrypt, encrypt } from './primitives';

/**
 * Generates an X25519 keypair for ECDH key agreement.
 */
export function generateKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/**
 * Encrypts a private key with the user's master key for secure storage.
 */
export function wrapPrivateKey(
  privateKey: Uint8Array,
  masterKey: Uint8Array,
): { encryptedPrivateKey: Uint8Array; iv: Uint8Array } {
  const { ciphertext: encryptedPrivateKey, iv } = encrypt(privateKey, masterKey);
  return { encryptedPrivateKey, iv };
}

/**
 * Decrypts a stored private key using the master key.
 * Throws if the master key is wrong.
 */
export function unwrapPrivateKey(
  encryptedPrivateKey: Uint8Array,
  masterKey: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  return decrypt(encryptedPrivateKey, masterKey, iv);
}

/**
 * Encrypts a vault key for a recipient using ECDH + AES-256-GCM.
 * The sender computes a shared secret via X25519, then uses it to encrypt the vault key.
 */
export function encryptVaultKeyForRecipient(
  vaultKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array,
): { ciphertext: Uint8Array; iv: Uint8Array } {
  const sharedSecret = x25519.getSharedSecret(senderPrivateKey, recipientPublicKey);
  const { ciphertext, iv } = encrypt(vaultKey, sharedSecret);
  return { ciphertext, iv };
}

/**
 * Decrypts a vault key that was encrypted for this recipient using ECDH + AES-256-GCM.
 */
export function decryptVaultKeyFromSender(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array,
): Uint8Array {
  const sharedSecret = x25519.getSharedSecret(recipientPrivateKey, senderPublicKey);
  return decrypt(ciphertext, sharedSecret, iv);
}
