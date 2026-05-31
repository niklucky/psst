// Set required env vars before any module reads process.env.
// dotenv (loaded by server/src/setup.ts) won't override values already set here.
process.env['DATABASE_URL'] = 'postgresql://postgres:dev@localhost:5432/psst_test';
process.env['SESSION_SECRET'] = 'test-session-secret-that-is-at-least-32-chars!';
process.env['STORAGE_ENDPOINT'] = 'http://localhost:9000';
process.env['STORAGE_ACCESS_KEY'] = 'minioadmin';
process.env['STORAGE_SECRET_KEY'] = 'minioadmin';
process.env['NODE_ENV'] = 'test';
