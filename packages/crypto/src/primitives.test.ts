import { describe, expect, it } from 'vitest';
import {
  decrypt,
  deriveMasterKey,
  encrypt,
  generateIV,
  generateKey,
  generateSalt,
} from './primitives';

describe('generateSalt', () => {
  it('returns 16 bytes', () => {
    expect(generateSalt().length).toBe(16);
  });

  it('produces different values each call', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).not.toEqual(b);
  });
});

describe('generateKey', () => {
  it('returns 32 bytes', () => {
    expect(generateKey().length).toBe(32);
  });
});

describe('generateIV', () => {
  it('returns 12 bytes', () => {
    expect(generateIV().length).toBe(12);
  });
});

describe('deriveMasterKey', () => {
  it('is deterministic: same password + salt → same key', () => {
    const password = 'correct horse battery staple';
    const salt = generateSalt();
    const key1 = deriveMasterKey(password, salt);
    const key2 = deriveMasterKey(password, salt);
    expect(key1).toEqual(key2);
  });

  it('produces different output for different salts', () => {
    const password = 'correct horse battery staple';
    const key1 = deriveMasterKey(password, generateSalt());
    const key2 = deriveMasterKey(password, generateSalt());
    expect(key1).not.toEqual(key2);
  });

  it('produces different output for different passwords', () => {
    const salt = generateSalt();
    const key1 = deriveMasterKey('password1', salt);
    const key2 = deriveMasterKey('password2', salt);
    expect(key1).not.toEqual(key2);
  });

  it('returns 32 bytes', () => {
    expect(deriveMasterKey('test', generateSalt()).length).toBe(32);
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips correctly', () => {
    const key = generateKey();
    const plaintext = new TextEncoder().encode('Hello, silo!');
    const { ciphertext, iv } = encrypt(plaintext, key);
    const recovered = decrypt(ciphertext, key, iv);
    expect(recovered).toEqual(plaintext);
  });

  it('throws when decrypting with the wrong key', () => {
    const key = generateKey();
    const wrongKey = generateKey();
    const plaintext = new TextEncoder().encode('secret');
    const { ciphertext, iv } = encrypt(plaintext, key);
    expect(() => decrypt(ciphertext, wrongKey, iv)).toThrow();
  });

  it('throws when decrypting with the wrong IV', () => {
    const key = generateKey();
    const plaintext = new TextEncoder().encode('secret');
    const { ciphertext } = encrypt(plaintext, key);
    const wrongIV = generateIV();
    expect(() => decrypt(ciphertext, key, wrongIV)).toThrow();
  });

  it('produces a different IV on each encrypt call', () => {
    const key = generateKey();
    const plaintext = new TextEncoder().encode('same message');
    const first = encrypt(plaintext, key);
    const second = encrypt(plaintext, key);
    expect(first.iv).not.toEqual(second.iv);
  });

  it('ciphertext is larger than plaintext (includes GCM tag)', () => {
    const key = generateKey();
    const plaintext = new TextEncoder().encode('short');
    const { ciphertext } = encrypt(plaintext, key);
    expect(ciphertext.length).toBeGreaterThan(plaintext.length);
  });
});
