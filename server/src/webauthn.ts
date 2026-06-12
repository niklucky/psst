import { env } from './env';

/**
 * Relying Party config for WebAuthn, derived from APP_URL.
 *
 * - `rpID` is the registrable domain (hostname only, no port/scheme) — it scopes
 *   which origins a credential may be used from and is baked into the credential
 *   at registration, so it must stay stable.
 * - `origin` is the full origin the browser reports; passed as `expectedOrigin`.
 */
const appUrl = new URL(env.APP_URL);

export const rpName = 'Silo';
export const rpID = appUrl.hostname;
export const origin = appUrl.origin;

/** WebAuthn ceremony challenge lifetime: 5 minutes. */
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
