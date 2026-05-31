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
