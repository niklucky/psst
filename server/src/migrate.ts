import './setup'; // must be first — loads .env before any other module initializes
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { db } from '@silo/db';

async function main() {
  await migrate(db, { migrationsFolder: resolve(__dirname, '../drizzle') });
  console.log('Migrations applied');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
