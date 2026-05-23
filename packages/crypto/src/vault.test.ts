import { describe, expect, it } from 'vitest';
import { generateSalt, deriveMasterKey } from './primitives';
import {
  createVaultKey,
  decryptSecret,
  encryptSecret,
  unwrapVaultKey,
  wrapVaultKey,
} from './vault';

describe('vault key operations', () => {
  it('full signup simulation: derive → create → wrap → unwrap → encrypt → decrypt', () => {
    // Simulate user signup
    const password = 'super-secret-password-123';
    const salt = generateSalt();
    const masterKey = deriveMasterKey(password, salt);

    // Create and wrap the vault key
    const vaultKey = createVaultKey();
    const { encryptedVaultKey, iv } = wrapVaultKey(vaultKey, masterKey);

    // Simulate login: derive master key again, unwrap vault key
    const masterKey2 = deriveMasterKey(password, salt);
    const unwrappedVaultKey = unwrapVaultKey(encryptedVaultKey, masterKey2, iv);
    expect(unwrappedVaultKey).toEqual(vaultKey);

    // Encrypt and decrypt a secret
    const secretText = JSON.stringify({ username: 'alice', password: 'hunter2' });
    const { ciphertext, iv: secretIV } = encryptSecret(secretText, unwrappedVaultKey);
    const recovered = decryptSecret(ciphertext, unwrappedVaultKey, secretIV);
    expect(recovered).toBe(secretText);
  });

  it('wrong master password fails at unwrapVaultKey, not at decryptSecret', () => {
    const correctPassword = 'correct-password';
    const wrongPassword = 'wrong-password';
    const salt = generateSalt();

    const masterKey = deriveMasterKey(correctPassword, salt);
    const wrongMasterKey = deriveMasterKey(wrongPassword, salt);

    const vaultKey = createVaultKey();
    const { encryptedVaultKey, iv } = wrapVaultKey(vaultKey, masterKey);

    // Wrong password must fail here — not silently produce a bad vault key
    expect(() => unwrapVaultKey(encryptedVaultKey, wrongMasterKey, iv)).toThrow();
  });

  it('each encryptSecret call produces a different IV', () => {
    const vaultKey = createVaultKey();
    const secret = 'the same message every time';

    const first = encryptSecret(secret, vaultKey);
    const second = encryptSecret(secret, vaultKey);
    const third = encryptSecret(secret, vaultKey);

    expect(first.iv).not.toEqual(second.iv);
    expect(second.iv).not.toEqual(third.iv);
    expect(first.iv).not.toEqual(third.iv);
  });

  it('decryptSecret correctly recovers unicode text', () => {
    const vaultKey = createVaultKey();
    const secret = '🔐 Top secret: café résumé naïve';
    const { ciphertext, iv } = encryptSecret(secret, vaultKey);
    expect(decryptSecret(ciphertext, vaultKey, iv)).toBe(secret);
  });

  it('createVaultKey returns 32 bytes', () => {
    expect(createVaultKey().length).toBe(32);
  });

  it('wrapped vault key is different from the original', () => {
    const masterKey = deriveMasterKey('password', generateSalt());
    const vaultKey = createVaultKey();
    const { encryptedVaultKey } = wrapVaultKey(vaultKey, masterKey);
    // Encrypted form should not equal the raw vault key
    expect(encryptedVaultKey).not.toEqual(vaultKey);
  });
});
