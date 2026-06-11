import { z } from 'zod/v4';

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  STORAGE_ENDPOINT: z.url(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().default('psst-files'),
  STORAGE_REGION: z.string().default('us-east-1'),
  /** Resend API key — emails are logged to the console instead when unset (dev/test) */
  RESEND_API_KEY: z.string().optional(),
  /** "From" header for outgoing emails, e.g. "Psst <noreply@yourdomain.com>" */
  EMAIL_FROM: z.string().optional(),
  /** Base URL of the web app — used to build links in emails */
  APP_URL: z.url().default('http://localhost:5173'),
  /**
   * Comma-separated CIDRs (e.g. "10.0.0.0/8,::1") of reverse proxies allowed to
   * set `x-forwarded-for`. The header is ignored unless the direct peer matches
   * one of these — otherwise the spoofable header is trusted and clients can
   * impersonate any device fingerprint. Empty (default) means never trust it.
   */
  TRUSTED_PROXIES: z.string().optional(),
});

function parseEnv() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }
  return result.data;
}

export const env = parseEnv();
