import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { env } from './env';

/** AES-256-GCM key for encrypting TOTP secrets at rest, derived from SESSION_SECRET. */
const ENCRYPTION_KEY = createHash('sha256').update(`${env.SESSION_SECRET}:totp`).digest();

/** Encrypts a base32 TOTP secret for storage. Format: `iv:authTag:ciphertext` (all hex). */
export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** Decrypts a TOTP secret stored by `encryptTotpSecret`. */
export function decryptTotpSecret(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted TOTP secret');
  }

  const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Generates a new random base32 TOTP secret. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** Builds the otpauth:// URL for QR-code enrollment. */
export function buildOtpauthUrl(secret: string, email: string): string {
  const totp = new TOTP({
    issuer: 'Psst',
    label: email,
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.toString();
}

/** Verifies a 6-digit TOTP code against a base32 secret, allowing 1 step of clock drift. */
export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.validate({ token: code, window: 1 }) !== null;
}
