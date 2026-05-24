import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Creates a pg Pool and returns a Drizzle client.
 * DATABASE_URL must be set in the environment.
 */
function createClient() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
  });

  return drizzle(pool, { schema });
}

export const db = createClient();
export type DrizzleClient = typeof db;
