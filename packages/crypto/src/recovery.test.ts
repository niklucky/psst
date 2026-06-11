import { describe, expect, it } from 'vitest';
import { deriveMasterKey, generateSalt } from './primitives';
import { createVaultKey } from './vault';
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  unwrapMasterKey,
  wrapMasterKey,
} from './recovery';

describe('recovery key operations', () => {
  it('full recovery simulation: derive → wrap master key → recover with code', () => {
    // A user with a master key sets up recovery.
    const masterKey = deriveMasterKey('master-password-123', generateSalt());
    const recoveryCode = generateRecoveryCode();
    const recoverySalt = generateSalt();

    const recoveryKey = deriveMasterKey(normalizeRecoveryCode(recoveryCode), recoverySalt);
    const { wrappedMasterKey, iv } = wrapMasterKey(masterKey, recoveryKey);

    // Later: the user types the code back (with its display formatting) to recover.
    const recoveryKey2 = deriveMasterKey(normalizeRecoveryCode(recoveryCode), recoverySalt);
    const recovered = unwrapMasterKey(wrappedMasterKey, recoveryKey2, iv);

    expect(recovered).toEqual(masterKey);
  });

  it('wrong recovery code fails at unwrapMasterKey', () => {
    const masterKey = createVaultKey();
    const recoverySalt = generateSalt();

    const recoveryKey = deriveMasterKey(normalizeRecoveryCode(generateRecoveryCode()), recoverySalt);
    const { wrappedMasterKey, iv } = wrapMasterKey(masterKey, recoveryKey);

    const wrongKey = deriveMasterKey(normalizeRecoveryCode(generateRecoveryCode()), recoverySalt);
    expect(() => unwrapMasterKey(wrappedMasterKey, wrongKey, iv)).toThrow();
  });

  it('normalizeRecoveryCode ignores formatting and case', () => {
    expect(normalizeRecoveryCode('a1b2-c3d4-E5F6')).toBe('a1b2c3d4e5f6');
    expect(normalizeRecoveryCode('  A1B2 c3d4 ')).toBe('a1b2c3d4');
  });

  it('generateRecoveryCode is high-entropy and unique', () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
    // 16 bytes → 32 hex chars after stripping the dash grouping.
    expect(normalizeRecoveryCode(a).length).toBe(32);
  });
});
