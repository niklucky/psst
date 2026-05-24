import { fromBase64, toBase64 } from '@psst/crypto';

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
