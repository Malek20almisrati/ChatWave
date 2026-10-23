import { randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const target = resolve(projectRoot, '.env');
const source = await readFile(resolve(projectRoot, '.env.example'), 'utf8');
const adminPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
const values = {
  POSTGRES_ADMIN_PASSWORD: adminPassword,
  DATABASE_ADMIN_URL: `postgres://chatwave_admin:${adminPassword}@127.0.0.1:5432/chatwave`,
  DATABASE_URL: `postgres://chatwave_app:${runtimePassword}@127.0.0.1:5432/chatwave`,
  APP_DB_PASSWORD: runtimePassword,
  SESSION_PEPPER: randomBytes(48).toString('base64url'),
  OTP_PEPPER: randomBytes(48).toString('base64url'),
  S3_SECRET_KEY: randomBytes(36).toString('base64url'),
};
const output = source.split(/\r?\n/).map((line) => {
  const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
  return key && Object.hasOwn(values, key) ? `${key}=${values[key]}` : line;
}).join('\n');

const file = await open(target, 'wx', 0o600).catch((error) => {
  if (error.code === 'EEXIST') throw new Error('A .env file already exists. Keep it and edit it yourself; this command never overwrites it.');
  throw error;
});
try { await file.writeFile(output); }
finally { await file.close(); }
process.stdout.write('Created a private local .env with random development secrets. Review it before starting the services.\n');
