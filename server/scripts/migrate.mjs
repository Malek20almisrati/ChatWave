import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const migrationsPath = resolve(here, '..', 'migrations');
const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimePassword = process.env.APP_DB_PASSWORD;

if (!adminUrl || !runtimePassword || runtimePassword.length < 32) {
  throw new Error('Set DATABASE_ADMIN_URL and a 32-character APP_DB_PASSWORD before applying migrations.');
}

const pool = new Pool({ connectionString: adminUrl, max: 2, application_name: 'chatwave-migrations' });
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(746201930)');
  const roleStatement = await client.query("SELECT format('CREATE ROLE chatwave_app LOGIN PASSWORD %L', $1) AS sql", [runtimePassword]);
  try {
    await client.query(roleStatement.rows[0].sql);
  } catch (error) {
    if (error.code !== '42710') throw error;
    const alterStatement = await client.query("SELECT format('ALTER ROLE chatwave_app WITH LOGIN PASSWORD %L', $1) AS sql", [runtimePassword]);
    await client.query(alterStatement.rows[0].sql);
  }
  const connectGrant = await client.query("SELECT format('GRANT CONNECT ON DATABASE %I TO chatwave_app', current_database()) AS statement");
  await client.query(connectGrant.rows[0].statement);
  await client.query('GRANT USAGE ON SCHEMA public TO chatwave_app');
  await client.query('CREATE TABLE IF NOT EXISTS chatwave_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    const alreadyApplied = await client.query('SELECT 1 FROM chatwave_migrations WHERE name = $1', [name]);
    if (alreadyApplied.rowCount) continue;
    const source = await readFile(resolve(migrationsPath, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(source);
      await client.query('INSERT INTO chatwave_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error });
    }
  }
  await client.query('GRANT USAGE ON SCHEMA public TO chatwave_app');
  await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chatwave_app');
  process.stdout.write('ChatWave database migrations are current.\n');
} finally {
  try { await client.query('SELECT pg_advisory_unlock(746201930)'); } catch {}
  client.release();
  await pool.end();
}
