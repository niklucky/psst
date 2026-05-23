import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Encodes a Uint8Array to a base64 string.
 * Uses the standard btoa() available in Node >= 16 and all modern browsers.
 */
export function toBase64(bytes: Uint8Array): string {
  // btoa only works with binary strings — convert via char codes
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string to a Uint8Array.
 */
export function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a Uint8Array to a lowercase hex string.
 * Wraps @noble/hashes so callers never import @noble directly.
 */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/**
 * Decodes a hex string to a Uint8Array.
 * Wraps @noble/hashes so callers never import @noble directly.
 */
export function fromHex(str: string): Uint8Array {
  return hexToBytes(str);
}

/**
 * Encodes a UTF-8 string to bytes.
 * Wraps @noble/hashes so callers never import @noble directly.
 */
export function textToBytes(str: string): Uint8Array {
  return utf8ToBytes(str);
}

/**
 * Decodes bytes to a UTF-8 string.
 */
export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
