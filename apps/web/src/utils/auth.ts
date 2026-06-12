import {
  deriveMasterKey,
  fromBase64,
  generateSalt,
  normalizeRecoveryCode,
  toBase64,
  wrapMasterKey,
} from '@silo/crypto';

/**
 * Parses the combined argon2Salt field that encodes both the master key salt
 * and the auth hash salt as a base64 JSON blob.
 * Legacy single-salt registrations are also handled.
 */
export function parseSaltField(argon2SaltFull: string): {
  masterSalt: Uint8Array;
  authSalt: Uint8Array;
} {
  try {
    const decoded = new TextDecoder().decode(fromBase64(argon2SaltFull));
    const parsed = JSON.parse(decoded) as { masterSalt: string; authSalt: string };
    return {
      masterSalt: fromBase64(parsed.masterSalt),
      authSalt: fromBase64(parsed.authSalt),
    };
  } catch {
    // Legacy format — treat the whole field as the master salt
    return { masterSalt: fromBase64(argon2SaltFull), authSalt: fromBase64(argon2SaltFull) };
  }
}

/**
 * Encodes the master salt + auth salt into the combined argon2Salt field.
 */
export function encodeSaltField(masterSalt: Uint8Array, authSalt: Uint8Array): string {
  return toBase64(
    new TextEncoder().encode(
      JSON.stringify({ masterSalt: toBase64(masterSalt), authSalt: toBase64(authSalt) }),
    ),
  );
}

/** The recovery blob the server stores — all fields base64. */
export interface RecoveryBlob {
  recoverySalt: string;
  recoveryAuthSalt: string;
  recoveryAuthHash: string;
  wrappedMasterKey: string;
  recoveryKeyIv: string;
}

/**
 * Derives a complete recovery blob from a recovery code and the master key,
 * entirely client-side. Used both when first setting up a recovery key and when
 * rotating it after a successful recovery. The server only ever sees the blob,
 * never the recovery code or the master key.
 */
export function buildRecoveryBlob(recoveryCode: string, masterKey: Uint8Array): RecoveryBlob {
  const normalized = normalizeRecoveryCode(recoveryCode);

  const recoverySalt = generateSalt();
  const recoveryAuthSalt = generateSalt();

  const recoveryKey = deriveMasterKey(normalized, recoverySalt);
  const { wrappedMasterKey, iv } = wrapMasterKey(masterKey, recoveryKey);

  const recoveryAuthHash = toBase64(
    deriveMasterKey(`recovery-auth:${normalized}`, recoveryAuthSalt),
  );

  return {
    recoverySalt: toBase64(recoverySalt),
    recoveryAuthSalt: toBase64(recoveryAuthSalt),
    recoveryAuthHash,
    wrappedMasterKey: toBase64(wrappedMasterKey),
    recoveryKeyIv: toBase64(iv),
  };
}
