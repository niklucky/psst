/**
 * TOTP (RFC 6238) code generator using the browser's WebCrypto API.
 * No external dependencies — relies on SubtleCrypto for HMAC-SHA1.
 */

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const ch of cleaned) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

/**
 * Generates the current TOTP code for a base32-encoded secret.
 * Throws if the secret is invalid or WebCrypto is unavailable.
 */
export async function generateTotp(secret: string): Promise<string> {
  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) throw new Error('Invalid TOTP secret');

  const timeStep = Math.floor(Date.now() / 1000 / 30);

  // Big-endian 8-byte time step (high 32 bits are 0 for all practical timestamps)
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(4, timeStep >>> 0, false);

  // Copy bytes into a plain ArrayBuffer — avoids the SharedArrayBuffer union type.
  const keyBuffer = new Uint8Array(keyBytes).buffer as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign'] as KeyUsage[],
  );

  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg.buffer));

  // RFC 4226 dynamic truncation
  const offset = mac[19]! & 0x0f;
  const code =
    (((mac[offset]! & 0x7f) << 24) |
      ((mac[offset + 1]! & 0xff) << 16) |
      ((mac[offset + 2]! & 0xff) << 8) |
      (mac[offset + 3]! & 0xff)) %
    1_000_000;

  return String(code).padStart(6, '0');
}

/** Seconds remaining in the current 30-second TOTP window. */
export function totpSecondsLeft(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}
