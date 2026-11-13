const path = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const migrator = require('drizzle-orm/node-postgres/migrator');
const { PGVECTOR_HINT } = require('./errorHint');
const { assertPgSearchReady, PgSearchNotReadyError } = require('./pgSearchGuard');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set, please set it in your environment variables.');
}

// The AI provider config and the sign-up allowlist belong to this admin account
if (!process.env.ADMIN_EMAIL?.trim()) {
  throw new Error(
    'ADMIN_EMAIL is not set. Set it in .env to the admin account email, then restart.',
  );
}

const client = new Pool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(client);

const runMigrations = async () => {
  console.log('[Database] Start to migration...');
  await migrator.migrate(db, {
    migrationsFolder: path.join(__dirname, './migrations'),
  });
  await assertPgSearchReady((text) => client.query(text));

  // ADMIN_EMAIL is the only source of the admin role: promote that account, demote everyone else
  const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  await client.query(
    `UPDATE users SET role = CASE WHEN lower(email) = $1 THEN 'admin' ELSE 'user' END
     WHERE role IS DISTINCT FROM (CASE WHEN lower(email) = $1 THEN 'admin' ELSE 'user' END)`,
    [adminEmail],
  );
  console.log(`👤 Admin role synced to ${adminEmail}`);

  console.log('✅ database migration pass.');
  console.log('-------------------------------------');
  process.exit(0);
};

runMigrations().catch((err) => {
  if (err instanceof PgSearchNotReadyError) {
    console.error(err.message);
    process.exit(1);
  }

  console.error(
    '❌ Database migrate failed. Please check your database is valid and DATABASE_URL is set correctly. The error detail is below:',
  );
  console.error(err);

  if (err.message.includes('extension "vector" is not available')) {
    console.info(PGVECTOR_HINT);
  }

  process.exit(1);
});
