import { describe, expect, it } from 'vitest';
import { generateKey } from './primitives';
import { createVaultKey, decryptSecret, encryptSecret } from './vault';
import {
  decryptVaultKeyFromSender,
  encryptVaultKeyForRecipient,
  generateKeypair,
  unwrapPrivateKey,
  wrapPrivateKey,
} from './sharing';

describe('keypair generation', () => {
  it('generates 32-byte public and private keys', () => {
    const { publicKey, privateKey } = generateKeypair();
    expect(publicKey.length).toBe(32);
    expect(privateKey.length).toBe(32);
  });

  it('produces unique keypairs each call', () => {
    const first = generateKeypair();
    const second = generateKeypair();
    expect(first.privateKey).not.toEqual(second.privateKey);
    expect(first.publicKey).not.toEqual(second.publicKey);
  });
});

describe('wrapPrivateKey / unwrapPrivateKey', () => {
  it('round-trips private key correctly', () => {
    const { privateKey } = generateKeypair();
    const masterKey = generateKey();
    const { encryptedPrivateKey, iv } = wrapPrivateKey(privateKey, masterKey);
    const recovered = unwrapPrivateKey(encryptedPrivateKey, masterKey, iv);
    expect(recovered).toEqual(privateKey);
  });

  it('throws with wrong master key', () => {
    const { privateKey } = generateKeypair();
    const masterKey = generateKey();
    const wrongKey = generateKey();
    const { encryptedPrivateKey, iv } = wrapPrivateKey(privateKey, masterKey);
    expect(() => unwrapPrivateKey(encryptedPrivateKey, wrongKey, iv)).toThrow();
  });
});

describe('ECDH vault key sharing', () => {
  it('Alice shares vault with Bob: encrypt → decrypt → use vault key', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();

    // Alice has a vault key and wants to share it with Bob
    const vaultKey = createVaultKey();

    // Alice encrypts the vault key for Bob using Bob's public key and her private key
    const { ciphertext, iv } = encryptVaultKeyForRecipient(
      vaultKey,
      bob.publicKey,
      alice.privateKey,
    );

    // Bob decrypts the vault key using Alice's public key and his private key
    const bobsVaultKey = decryptVaultKeyFromSender(ciphertext, iv, alice.publicKey, bob.privateKey);
    expect(bobsVaultKey).toEqual(vaultKey);

    // Bob can now decrypt secrets with the vault key
    const secret = '{"password":"super-secret-123"}';
    const { ciphertext: secretCT, iv: secretIV } = encryptSecret(secret, vaultKey);
    expect(decryptSecret(secretCT, bobsVaultKey, secretIV)).toBe(secret);
  });

  it('ECDH is symmetric — shared secret is the same from both directions', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const vaultKey = createVaultKey();

    // Alice → Bob direction
    const { ciphertext: ct1, iv: iv1 } = encryptVaultKeyForRecipient(
      vaultKey,
      bob.publicKey,
      alice.privateKey,
    );
    const recovered1 = decryptVaultKeyFromSender(ct1, iv1, alice.publicKey, bob.privateKey);

    // Bob → Alice direction (Bob shares a different vault key with Alice)
    const vaultKey2 = createVaultKey();
    const { ciphertext: ct2, iv: iv2 } = encryptVaultKeyForRecipient(
      vaultKey2,
      alice.publicKey,
      bob.privateKey,
    );
    const recovered2 = decryptVaultKeyFromSender(ct2, iv2, bob.publicKey, alice.privateKey);

    expect(recovered1).toEqual(vaultKey);
    expect(recovered2).toEqual(vaultKey2);
  });

  it('wrong private key fails decryption', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const eve = generateKeypair();

    const vaultKey = createVaultKey();
    const { ciphertext, iv } = encryptVaultKeyForRecipient(
      vaultKey,
      bob.publicKey,
      alice.privateKey,
    );

    // Eve tries to decrypt with her own private key — must fail
    expect(() => decryptVaultKeyFromSender(ciphertext, iv, alice.publicKey, eve.privateKey)).toThrow();
  });
});
