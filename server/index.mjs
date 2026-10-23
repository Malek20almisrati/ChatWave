import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const isProduction = process.env.NODE_ENV === 'production';
const requiredEnv = ['DATABASE_URL', 'SESSION_PEPPER', 'OTP_PEPPER', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
for (const key of requiredEnv) if (!process.env[key]) throw new Error(`Missing required environment setting: ${key}`);
if (process.env.SESSION_PEPPER.length < 32 || process.env.OTP_PEPPER.length < 32) throw new Error('Session and OTP peppers must each contain at least 32 characters.');
if (isProduction && (process.env.COOKIE_SECURE !== 'true' || process.env.SMS_PROVIDER !== 'twilio' || process.env.PGSSL !== 'require' || !process.env.S3_ENDPOINT?.startsWith('https://'))) throw new Error('Production requires secure cookies, PostgreSQL TLS, HTTPS object storage, and a configured SMS provider.');
const storageOrigin = new URL(process.env.S3_ENDPOINT).origin;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 12),
  application_name: 'chatwave-api',
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: true } : undefined,
});
const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'), redact: ['req.headers.cookie', 'req.headers.authorization', 'body.password', 'body.code'] },
  bodyLimit: 256 * 1024,
  trustProxy: process.env.TRUST_PROXY === 'true',
});
await app.register(rateLimit, { global: false, max: 120, timeWindow: '1 minute' });

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProduction) reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  reply.header('Content-Security-Policy', `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: ${storageOrigin}; media-src 'self' blob: ${storageOrigin}; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ${storageOrigin}`);
  return payload;
});

const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode, code });
app.setErrorHandler((error, request, reply) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, 'request failed');
  return reply.code(status).send({ error: status >= 500 ? 'server_error' : (error.code || 'request_rejected') });
});

const digest = (value, pepper) => createHmac('sha256', pepper).update(value).digest();
const equalDigest = (left, right) => Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && timingSafeEqual(left, right);
const validPhone = (value) => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
const validCountry = (value) => typeof value === 'string' && /^[A-Z]{2}$/.test(value);
const birthDateAge = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const birth = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== value || birth > new Date()) return NaN;
  const now = new Date();
  return now.getUTCFullYear() - birth.getUTCFullYear() - ((now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) ? 1 : 0);
};
const sqlDate = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const cleanFilename = (value) => value.normalize('NFKC').replace(/[\\/\u0000-\u001f]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180) || 'upload';
const sessionCookieName = 'cw_session';
const cookieValue = (request, name) => {
  const pair = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
};
const sessionCookie = (token, maxAge) => `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
const clearSessionCookie = () => `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;

async function userTransaction(userId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireSession(request, reply) {
  const token = cookieValue(request, sessionCookieName);
  if (!token || token.length > 128) return reply.code(401).send({ error: 'sign_in_required' });
  const result = await pool.query('SELECT user_id FROM resolve_session($1)', [digest(token, process.env.SESSION_PEPPER)]);
  if (!result.rowCount) return reply.code(401).send({ error: 'session_expired' });
  request.userId = result.rows[0].user_id;
}

async function sendOtp(phone, code) {
  const provider = process.env.SMS_PROVIDER || 'console';
  if (provider === 'console' && !isProduction) {
    app.log.info({ phone, otp: code }, 'development-only verification code');
    return { developmentCode: code };
  }
  if (provider !== 'twilio' || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
    throw fail(503, 'sms_provider_unavailable');
  }
  const account = process.env.TWILIO_ACCOUNT_SID;
  const credentials = Buffer.from(`${account}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM_NUMBER, Body: `Your ChatWave verification code is ${code}. It expires in five minutes.` });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw fail(503, 'sms_delivery_failed');
  return {};
}

async function createChallenge({ purpose, phone, code, userId = null, passwordHash = null, birthDate = null, countryCode = null, deliver = true }) {
  const recent = await pool.query("SELECT count(*)::int AS count FROM otp_challenges WHERE phone_e164 = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'", [phone, purpose]);
  if (recent.rows[0].count >= 5) throw fail(429, 'too_many_verification_requests');
  await pool.query("UPDATE otp_challenges SET consumed_at = now() WHERE phone_e164 = $1 AND purpose = $2 AND consumed_at IS NULL", [phone, purpose]);
  const inserted = await pool.query(
    `INSERT INTO otp_challenges (purpose, phone_e164, user_id, otp_hash, pending_password_hash, pending_birth_date, pending_country_code, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '5 minutes') RETURNING id`,
    [purpose, phone, userId, digest(code, process.env.OTP_PEPPER), passwordHash, birthDate, countryCode],
  );
  try {
    const delivery = deliver ? await sendOtp(phone, code) : {};
    return { challengeId: inserted.rows[0].id, expiresInSeconds: 300, ...delivery };
  } catch (error) {
    await pool.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [inserted.rows[0].id]);
    throw error;
  }
}

async function verifyChallenge(challengeId, code, purpose) {
  if (!/^\d{6}$/.test(code)) throw fail(400, 'invalid_verification_code');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM otp_challenges WHERE id = $1 AND purpose = $2 FOR UPDATE', [challengeId, purpose]);
    const challenge = found.rows[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date() || challenge.attempts >= 5) throw fail(400, 'verification_challenge_expired');
    if (!equalDigest(challenge.otp_hash, digest(code, process.env.OTP_PEPPER))) {
      await client.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
      await client.query('COMMIT');
      throw fail(400, 'invalid_verification_code');
    }
    if (purpose === 'register') {
      const registrationToken = randomBytes(32).toString('base64url');
      await client.query('UPDATE otp_challenges SET verified_at = now(), registration_token_hash = $2, registration_token_expires_at = now() + interval \'15 minutes\' WHERE id = $1', [challenge.id, digest(registrationToken, process.env.SESSION_PEPPER)]);
      await client.query('COMMIT');
      return { registrationToken, expiresInSeconds: 900 };
    }
    if (purpose === 'recovery') {
      const recoveryToken = randomBytes(32).toString('base64url');
      await client.query('UPDATE otp_challenges SET verified_at = now(), recovery_token_hash = $2, recovery_token_expires_at = now() + interval \'10 minutes\' WHERE id = $1', [challenge.id, digest(recoveryToken, process.env.SESSION_PEPPER)]);
      await client.query('COMMIT');
      return { recoveryToken, expiresInSeconds: 600 };
    }
    const token = randomBytes(32).toString('base64url');
    const userId = challenge.user_id;
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query('INSERT INTO account_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'7 days\')', [userId, digest(token, process.env.SESSION_PEPPER)]);
    await client.query('UPDATE otp_challenges SET verified_at = now(), consumed_at = now() WHERE id = $1', [challenge.id]);
    await client.query('COMMIT');
    return { userId, token };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

app.get('/api/health', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_request, reply) => {
  try { await pool.query('SELECT 1'); return { status: 'ok' }; }
  catch { return reply.code(503).send({ status: 'unavailable' }); }
});

app.post('/api/auth/register/start', {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  schema: { body: { type: 'object', additionalProperties: false, required: ['phone', 'password', 'birthDate', 'countryCode'], properties: { phone: { type: 'string', maxLength: 16 }, password: { type: 'string', minLength: 12, maxLength: 256 }, birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, countryCode: { type: 'string', pattern: '^[A-Z]{2}$' } } } },
}, async (request, reply) => {
  const { phone, password, birthDate, countryCode } = request.body;
  if (!validPhone(phone) || !validCountry(countryCode) || !Number.isFinite(birthDateAge(birthDate))) throw fail(400, 'invalid_registration_details');
  if (birthDateAge(birthDate) < 18) throw fail(403, 'guardian_verification_required');
  if (!/[\p{L}]/u.test(password) || !/\p{N}/u.test(password)) throw fail(400, 'password_policy_failed');
  const existing = await pool.query('SELECT id FROM lookup_user_by_phone($1)', [phone]);
  if (existing.rowCount) throw fail(409, 'registration_unavailable');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  const result = await createChallenge({ purpose: 'register', phone, code: newOtp(), passwordHash, birthDate, countryCode });
  return reply.code(202).send(result);
});

app.post('/api/auth/register/verify', {
  config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  schema: { body: { type: 'object', additionalProperties: false, required: ['challengeId', 'code'], properties: { challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', minLength: 6, maxLength: 6 } } } },
}, async (request) => verifyChallenge(request.body.challengeId, request.body.code, 'register'));

app.post('/api/auth/register/complete', {
  config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  schema: { body: { type: 'object', additionalProperties: false, required: ['registrationToken', 'displayName', 'username', 'gender'], properties: { registrationToken: { type: 'string', minLength: 40, maxLength: 64 }, displayName: { type: 'string', minLength: 1, maxLength: 48 }, username: { type: 'string', pattern: '^[A-Za-z0-9._]{3,24}$' }, bio: { type: 'string', maxLength: 160 }, gender: { type: 'string', enum: ['male', 'female'] }, interests: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } } } } },
}, async (request, reply) => {
  const tokenHash = digest(request.body.registrationToken, process.env.SESSION_PEPPER);
  const client = await pool.connect();
  const sessionToken = randomBytes(32).toString('base64url');
  const userId = randomUUID();
  try {
    await client.query('BEGIN');
    const pending = await client.query('SELECT * FROM otp_challenges WHERE registration_token_hash = $1 AND purpose = \'register\' AND verified_at IS NOT NULL AND consumed_at IS NULL AND registration_token_expires_at > now() FOR UPDATE', [tokenHash]);
    const challenge = pending.rows[0];
    if (!challenge || birthDateAge(sqlDate(challenge.pending_birth_date)) < 18) throw fail(400, 'registration_session_expired');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query('INSERT INTO users (id, phone_e164, password_hash, birth_date, country_code, display_name, username, bio, gender) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [userId, challenge.phone_e164, challenge.pending_password_hash, challenge.pending_birth_date, challenge.pending_country_code, request.body.displayName.trim(), request.body.username, request.body.bio || '', request.body.gender]);
    for (const interest of [...new Set(request.body.interests || [])]) await client.query('INSERT INTO user_interests (user_id, interest_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, interest]);
    await client.query('INSERT INTO account_sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval \'7 days\')', [userId, digest(sessionToken, process.env.SESSION_PEPPER)]);
    await client.query('UPDATE otp_challenges SET consumed_at = now(), registration_token_hash = NULL WHERE id = $1', [challenge.id]);
    await client.query('COMMIT');
    reply.header('Set-Cookie', sessionCookie(sessionToken, 7 * 24 * 60 * 60));
    return { user: { id: userId, displayName: request.body.displayName.trim(), username: request.body.username, bio: request.body.bio || '', countryCode: challenge.pending_country_code } };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw fail(409, 'username_or_phone_unavailable');
    throw error;
  } finally {
    client.release();
  }
});

const dummyPasswordHash = await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
app.post('/api/auth/login/start', {
  config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  schema: { body: { type: 'object', additionalProperties: false, required: ['phone', 'password'], properties: { phone: { type: 'string', maxLength: 16 }, password: { type: 'string', minLength: 1, maxLength: 256 } } } },
}, async (request, reply) => {
  const { phone, password } = request.body;
  if (!validPhone(phone)) throw fail(400, 'invalid_login_details');
  const result = await pool.query('SELECT id, password_hash, status FROM lookup_user_by_phone($1)', [phone]);
  const account = result.rows[0];
  const matches = await argon2.verify(account?.password_hash || dummyPasswordHash, password).catch(() => false);
  if (!account || account.status !== 'active' || !matches) throw fail(401, 'invalid_login_details');
  const challenge = await createChallenge({ purpose: 'login', phone, userId: account.id, code: newOtp() });
  return reply.code(202).send(challenge);
});

app.post('/api/auth/login/verify', {
  config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  schema: { body: { type: 'object', additionalProperties: false, required: ['challengeId', 'code'], properties: { challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', minLength: 6, maxLength: 6 } } } },
}, async (request, reply) => {
  const result = await verifyChallenge(request.body.challengeId, request.body.code, 'login');
  reply.header('Set-Cookie', sessionCookie(result.token, 7 * 24 * 60 * 60));
  return { ok: true };
});

app.post('/api/auth/recovery/start', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: { body: { type: 'object', additionalProperties: false, required: ['phone'], properties: { phone: { type: 'string', maxLength: 16 } } } } }, async (request, reply) => {
  if (!validPhone(request.body.phone)) throw fail(400, 'invalid_login_details');
  const account = await pool.query('SELECT id, status FROM lookup_user_by_phone($1)', [request.body.phone]);
  const eligibleUserId = account.rows[0] && ['active', 'deactivated'].includes(account.rows[0].status) ? account.rows[0].id : null;
  const result = await createChallenge({ purpose: 'recovery', phone: request.body.phone, userId: eligibleUserId, code: newOtp(), deliver: Boolean(eligibleUserId) });
  return reply.code(202).send({ challengeId: result.challengeId, expiresInSeconds: result.expiresInSeconds });
});

app.post('/api/auth/recovery/verify', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } }, schema: { body: { type: 'object', additionalProperties: false, required: ['challengeId', 'code'], properties: { challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', minLength: 6, maxLength: 6 } } } } }, async (request) => verifyChallenge(request.body.challengeId, request.body.code, 'recovery'));

app.post('/api/auth/recovery/complete', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: { body: { type: 'object', additionalProperties: false, required: ['recoveryToken', 'password'], properties: { recoveryToken: { type: 'string', minLength: 40, maxLength: 64 }, password: { type: 'string', minLength: 12, maxLength: 256 } } } } }, async (request) => {
  if (!/[\p{L}]/u.test(request.body.password) || !/\p{N}/u.test(request.body.password)) throw fail(400, 'password_policy_failed');
  const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  const result = await pool.query('SELECT complete_account_recovery($1,$2) AS completed', [digest(request.body.recoveryToken, process.env.SESSION_PEPPER), passwordHash]);
  if (!result.rows[0]?.completed) throw fail(400, 'recovery_token_invalid');
  return { ok: true };
});

app.get('/api/session', { preHandler: requireSession }, async (request) => userTransaction(request.userId, async (client) => {
  const user = await client.query('SELECT id, display_name, username, bio, country_code, visibility, avatar_media_id FROM users WHERE id = $1 AND status = \'active\'', [request.userId]);
  if (!user.rowCount) throw fail(401, 'session_expired');
  const interests = await client.query('SELECT interest_key FROM user_interests WHERE user_id = $1 ORDER BY interest_key', [request.userId]);
  const counts = await client.query(`SELECT
    (SELECT count(*)::integer FROM friendships WHERE state = 'accepted' AND (requester_id = $1 OR recipient_id = $1)) AS friends,
    (SELECT count(*)::integer FROM posts WHERE author_id = $1 AND deleted_at IS NULL) AS posts,
    (SELECT count(*)::integer FROM channel_videos v JOIN channels c ON c.id = v.channel_id WHERE c.owner_id = $1) AS videos`, [request.userId]);
  return { user: user.rows[0], interests: interests.rows.map((row) => row.interest_key), counts: counts.rows[0] };
}));

app.patch('/api/profile', { preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['displayName', 'username', 'bio', 'visibility'], properties: { displayName: { type: 'string', minLength: 1, maxLength: 48 }, username: { type: 'string', pattern: '^[A-Za-z0-9._]{3,24}$' }, bio: { type: 'string', maxLength: 160 }, visibility: { type: 'string', enum: ['private', 'friends', 'public'] }, avatarMediaId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  if (request.body.avatarMediaId) {
    const avatar = await client.query("SELECT 1 FROM media_assets WHERE id = $1 AND owner_id = $2 AND kind = 'image' AND state = 'ready'", [request.body.avatarMediaId, request.userId]);
    if (!avatar.rowCount) throw fail(400, 'avatar_not_ready');
  }
  const hasAvatarField = Object.hasOwn(request.body, 'avatarMediaId');
  const result = await client.query('UPDATE users SET display_name = $2, username = $3, bio = $4, visibility = $5, avatar_media_id = CASE WHEN $6 THEN $7::uuid ELSE avatar_media_id END, updated_at = now() WHERE id = $1 RETURNING id, display_name, username, bio, visibility, avatar_media_id', [request.userId, request.body.displayName.trim(), request.body.username, request.body.bio, request.body.visibility, hasAvatarField, request.body.avatarMediaId || null]);
  return { user: result.rows[0] };
}));

app.get('/api/people/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { querystring: { type: 'object', additionalProperties: false, required: ['username'], properties: { username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query('SELECT id, username, display_name, visibility FROM lookup_user_card_by_username($1) WHERE id <> $2', [request.query.username.replace(/^@/, ''), request.userId]);
  return { people: result.rows };
}));

app.get('/api/friends', { preHandler: requireSession }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query("SELECT CASE WHEN requester_id = $1 THEN recipient_id ELSE requester_id END AS friend_id FROM friendships WHERE state = 'accepted' AND (requester_id = $1 OR recipient_id = $1) ORDER BY updated_at DESC LIMIT 500", [request.userId]);
  const friends = [];
  for (const row of result.rows) {
    const person = await client.query('SELECT id, username, display_name, visibility FROM lookup_user_card_by_id($1)', [row.friend_id]);
    if (person.rowCount) friends.push(person.rows[0]);
  }
  return { friends };
}));

app.get('/api/friend-requests', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: requireSession }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query("SELECT requester_id FROM friendships WHERE recipient_id = $1 AND state = 'pending' ORDER BY created_at DESC LIMIT 100", [request.userId]);
  const requests = [];
  for (const row of result.rows) {
    const person = await client.query('SELECT id, username, display_name, visibility FROM lookup_user_card_by_id($1)', [row.requester_id]);
    if (person.rowCount) requests.push(person.rows[0]);
  }
  return { requests };
}));

app.post('/api/friend-requests', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['username'], properties: { username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' } } } } }, async (request, reply) => userTransaction(request.userId, async (client) => {
  const person = await client.query('SELECT id FROM lookup_user_card_by_username($1)', [request.body.username.replace(/^@/, '')]);
  if (!person.rowCount || person.rows[0].id === request.userId) throw fail(404, 'people_not_available');
  const targetId = person.rows[0].id;
  const reverse = await client.query("UPDATE friendships SET state = 'accepted', updated_at = now() WHERE requester_id = $1 AND recipient_id = $2 AND state = 'pending' RETURNING state", [targetId, request.userId]);
  if (reverse.rowCount) return { state: 'accepted' };
  const existing = await client.query('SELECT state FROM friendships WHERE requester_id = $1 AND recipient_id = $2', [request.userId, targetId]);
  if (existing.rowCount) {
    if (existing.rows[0].state === 'blocked') throw fail(403, 'people_not_available');
    return { state: existing.rows[0].state };
  }
  await client.query("INSERT INTO friendships (requester_id, recipient_id, state) VALUES ($1, $2, 'pending')", [request.userId, targetId]);
  return reply.code(201).send({ state: 'pending' });
}));

app.post('/api/friend-requests/:username/accept', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { params: { type: 'object', required: ['username'], properties: { username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const person = await client.query('SELECT id FROM lookup_user_card_by_username($1)', [request.params.username.replace(/^@/, '')]);
  if (!person.rowCount) throw fail(404, 'people_not_available');
  const updated = await client.query("UPDATE friendships SET state = 'accepted', updated_at = now() WHERE requester_id = $1 AND recipient_id = $2 AND state = 'pending' RETURNING state", [person.rows[0].id, request.userId]);
  if (!updated.rowCount) throw fail(404, 'friend_request_not_found');
  return { state: 'accepted' };
}));

app.post('/api/auth/logout', { preHandler: requireSession }, async (request, reply) => {
  await userTransaction(request.userId, async (client) => client.query('UPDATE account_sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL', [request.userId, digest(cookieValue(request, sessionCookieName), process.env.SESSION_PEPPER)]));
  reply.header('Set-Cookie', clearSessionCookie());
  return { ok: true };
});

app.post('/api/account/deactivate', { preHandler: requireSession }, async (request, reply) => {
  const result = await userTransaction(request.userId, (client) => client.query('SELECT deactivate_account($1) AS deactivated', [request.userId]));
  if (!result.rows[0]?.deactivated) throw fail(409, 'account_deactivation_unavailable');
  reply.header('Set-Cookie', clearSessionCookie());
  return { ok: true };
});

app.get('/api/posts', { preHandler: requireSession }, async (request) => userTransaction(request.userId, async (client) => {
  const posts = await client.query(
    `SELECT p.id, p.body, p.audience, p.context_tag, p.created_at, u.id AS author_id, u.display_name, u.username
     FROM posts p JOIN users u ON u.id = p.author_id
     WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 50`,
  );
  return { posts: posts.rows };
}));

app.post('/api/posts', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['body', 'audience'], properties: { body: { type: 'string', maxLength: 5000 }, audience: { type: 'string', enum: ['private', 'friends', 'public'] }, contextTag: { type: 'string', maxLength: 32 } } } } }, async (request, reply) => userTransaction(request.userId, async (client) => {
  if (!request.body.body.trim()) throw fail(400, 'post_text_required');
  const account = await client.query('SELECT visibility FROM users WHERE id = $1', [request.userId]);
  if (account.rows[0]?.visibility === 'private' && request.body.audience === 'public') throw fail(403, 'public_post_blocked_by_privacy');
  const result = await client.query('INSERT INTO posts (author_id, body, audience, context_tag) VALUES ($1,$2,$3,$4) RETURNING id, body, audience, context_tag, created_at', [request.userId, request.body.body.trim(), request.body.audience, request.body.contextTag || null]);
  return reply.code(201).send({ post: result.rows[0] });
}));

app.get('/api/conversations', { preHandler: requireSession }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query(
    `SELECT c.id, c.kind, c.title, c.description, c.visibility, c.join_mode, c.allow_forwarding,
            c.invite_token, c.created_by, cm.role AS my_role, c.created_at,
            (SELECT u.display_name FROM conversation_members other JOIN users u ON u.id = other.user_id
             WHERE other.conversation_id = c.id AND other.user_id <> $1 AND other.left_at IS NULL ORDER BY other.joined_at LIMIT 1) AS peer_name,
            (SELECT u.username FROM conversation_members other JOIN users u ON u.id = other.user_id
             WHERE other.conversation_id = c.id AND other.user_id <> $1 AND other.left_at IS NULL ORDER BY other.joined_at LIMIT 1) AS peer_username
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = $1 AND cm.left_at IS NULL AND c.archived_at IS NULL
     ORDER BY c.created_at DESC LIMIT 100`, [request.userId],
  );
  return { conversations: result.rows };
}));

app.post('/api/conversations', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['kind', 'participantUsernames'], properties: { kind: { type: 'string', enum: ['direct', 'group'] }, title: { type: 'string', maxLength: 80 }, description: { type: 'string', maxLength: 500 }, visibility: { type: 'string', enum: ['private', 'public'] }, joinMode: { type: 'string', enum: ['invite', 'request', 'open'] }, allowForwarding: { type: 'boolean' }, participantUsernames: { type: 'array', maxItems: 49, items: { type: 'string', pattern: '^[A-Za-z0-9._]{3,24}$' } } } } } }, async (request, reply) => userTransaction(request.userId, async (client) => {
  const usernames = [...new Set(request.body.participantUsernames.map((name) => name.toLowerCase()))];
  if (request.body.kind === 'direct' && usernames.length !== 1) throw fail(400, 'direct_chat_requires_one_person');
  if (request.body.kind === 'group' && !request.body.title?.trim()) throw fail(400, 'group_title_required');
  const isGroup = request.body.kind === 'group';
  const participants = await client.query('SELECT id, username FROM users WHERE lower(username) = ANY($1::text[]) AND status = \'active\'', [usernames]);
  if (participants.rowCount !== usernames.length || participants.rows.some((row) => row.id === request.userId)) throw fail(404, 'people_not_available');
  const ids = participants.rows.map((row) => row.id);
  for (const id of ids) {
    const friendship = await client.query("SELECT 1 FROM friendships WHERE state = 'accepted' AND ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1))", [request.userId, id]);
    if (!friendship.rowCount) throw fail(403, 'friends_only_messaging');
  }
  const inviteToken = isGroup ? randomBytes(24).toString('base64url') : null;
  const visibility = isGroup ? (request.body.visibility || 'private') : 'private';
  const joinMode = isGroup ? (request.body.joinMode || 'invite') : 'invite';
  if (joinMode === 'open' && visibility !== 'public') throw fail(400, 'public_group_required_for_open_join');
  const conversation = await client.query(
    'INSERT INTO conversations (kind, title, description, visibility, join_mode, allow_forwarding, invite_token, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, title, description, visibility, join_mode, allow_forwarding, invite_token, created_at',
    [request.body.kind, isGroup ? request.body.title.trim() : null, isGroup ? (request.body.description?.trim() || '') : '', visibility, joinMode, isGroup ? (request.body.allowForwarding ?? true) : true, inviteToken, request.userId],
  );
  const id = conversation.rows[0].id;
  await client.query("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'owner')", [id, request.userId]);
  for (const participantId of ids) await client.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2)', [id, participantId]);
  return reply.code(201).send({ conversation: conversation.rows[0] });
}));

app.patch('/api/conversations/:id/settings', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', maxLength: 500 }, visibility: { type: 'string', enum: ['private', 'public'] }, joinMode: { type: 'string', enum: ['invite', 'request', 'open'] }, allowForwarding: { type: 'boolean' }, rotateInviteLink: { type: 'boolean' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const before = await client.query('SELECT visibility, join_mode FROM conversations WHERE id = $1 AND kind = \'group\'', [request.params.id]);
  if (!before.rowCount) throw fail(404, 'group_not_found');
  const visibility = request.body.visibility || before.rows[0].visibility;
  const joinMode = request.body.joinMode || before.rows[0].join_mode;
  if (joinMode === 'open' && visibility !== 'public') throw fail(400, 'public_group_required_for_open_join');
  const result = await client.query(
    `UPDATE conversations SET
      title = COALESCE($2, title), description = COALESCE($3, description), visibility = $4, join_mode = $5,
      allow_forwarding = COALESCE($6, allow_forwarding),
      invite_token = CASE WHEN $7::boolean THEN encode(gen_random_bytes(24), 'hex') ELSE invite_token END
     WHERE id = $1 AND kind = 'group'
     RETURNING id, title, description, visibility, join_mode, allow_forwarding, invite_token`,
    [request.params.id, request.body.title?.trim() || null, request.body.description?.trim() ?? null, visibility, joinMode, request.body.allowForwarding ?? null, request.body.rotateInviteLink === true],
  );
  if (!result.rowCount) throw fail(403, 'group_admin_required');
  return { group: result.rows[0] };
}));

app.get('/api/conversations/:id/members', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query(
    `SELECT u.username, u.display_name, cm.role, cm.joined_at
       FROM conversation_members cm CROSS JOIN LATERAL lookup_user_card_by_id(cm.user_id) u
      WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
      ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at`,
    [request.params.id],
  );
  return { members: result.rows };
}));

app.patch('/api/conversations/:id/members/:username/role', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id', 'username'], properties: { id: { type: 'string', format: 'uuid' }, username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' } } }, body: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: { type: 'string', enum: ['admin', 'member'] } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const user = await client.query('SELECT id FROM lookup_user_card_by_username($1)', [request.params.username]);
  if (!user.rowCount) throw fail(404, 'people_not_available');
  const result = await client.query('SELECT set_group_member_role($1,$2,$3,$4) AS updated', [request.userId, request.params.id, user.rows[0].id, request.body.role]);
  if (!result.rows[0]?.updated) throw fail(403, 'group_owner_required');
  return { member: { username: request.params.username, role: request.body.role } };
}));

app.post('/api/groups/join', { preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['inviteToken'], properties: { inviteToken: { type: 'string', minLength: 20, maxLength: 128 } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query('SELECT * FROM join_group_by_token($1, $2)', [request.userId, request.body.inviteToken]);
  if (!result.rowCount) throw fail(404, 'group_invite_not_found');
  return { group: result.rows[0] };
}));

app.get('/api/conversations/:id/join-requests', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query("SELECT r.id, r.status, r.created_at, u.username, u.display_name FROM group_join_requests r CROSS JOIN LATERAL lookup_user_card_by_id(r.user_id) u WHERE r.conversation_id = $1 AND r.status = 'pending' ORDER BY r.created_at LIMIT 100", [request.params.id]);
  return { requests: result.rows };
}));

app.post('/api/conversations/:id/join-requests/:requestId', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id', 'requestId'], properties: { id: { type: 'string', format: 'uuid' }, requestId: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['accept'], properties: { accept: { type: 'boolean' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query('SELECT * FROM review_group_join_request($1, $2, $3)', [request.userId, request.params.requestId, request.body.accept]);
  if (!result.rowCount || result.rows[0].conversation_id !== request.params.id) throw fail(403, 'group_admin_required');
  return { request: result.rows[0] };
}));

app.post('/api/channels', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } }, preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['title', 'username', 'visibility'], properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, username: { type: 'string', pattern: '^[A-Za-z0-9._]{3,24}$' }, description: { type: 'string', maxLength: 500 }, visibility: { type: 'string', enum: ['private', 'public'] }, adminUsernames: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' } } } } } }, async (request, reply) => userTransaction(request.userId, async (client) => {
  const token = randomBytes(24).toString('base64url');
  try {
    const result = await client.query('INSERT INTO channels (owner_id, title, username, description, visibility, invite_token) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, username, description, visibility, invite_token, created_at', [request.userId, request.body.title.trim(), request.body.username, request.body.description?.trim() || '', request.body.visibility, token]);
    const channel = result.rows[0];
    const admins = [...new Set((request.body.adminUsernames || []).map((name) => name.toLowerCase()))];
    for (const username of admins) {
      const admin = await client.query('SELECT id FROM lookup_user_card_by_username($1)', [username]);
      if (!admin.rowCount || admin.rows[0].id === request.userId) throw fail(400, 'invalid_channel_admin');
      const added = await client.query('SELECT set_channel_admin($1,$2,$3,true) AS updated', [request.userId, channel.id, admin.rows[0].id]);
      if (!added.rows[0]?.updated) throw fail(400, 'invalid_channel_admin');
    }
    return reply.code(201).send({ channel });
  } catch (error) {
    if (error.code === '23505') throw fail(409, 'channel_username_unavailable');
    throw error;
  }
}));

app.get('/api/channels', { preHandler: requireSession }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query('SELECT c.id, c.title, c.username, c.description, c.visibility, c.invite_token, c.created_at, EXISTS (SELECT 1 FROM channel_subscribers s WHERE s.channel_id = c.id AND s.user_id = $1) AS following FROM channels c ORDER BY c.created_at DESC LIMIT 100', [request.userId]);
  return { channels: result.rows };
}));

app.post('/api/channels/follow', { preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' }, inviteToken: { type: 'string', minLength: 20, maxLength: 128 } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  if (Boolean(request.body.username) === Boolean(request.body.inviteToken)) throw fail(400, 'channel_link_invalid');
  const result = await client.query('SELECT * FROM join_channel_by_link($1,$2,$3)', [request.userId, request.body.username || null, request.body.inviteToken || null]);
  if (!result.rowCount) throw fail(404, 'channel_link_invalid');
  return { channel: result.rows[0] };
}));

app.delete('/api/channels/:id/follow', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  await client.query('DELETE FROM channel_subscribers WHERE channel_id = $1 AND user_id = $2', [request.params.id, request.userId]);
  return { ok: true };
}));

app.patch('/api/channels/:id/settings', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', maxLength: 500 }, visibility: { type: 'string', enum: ['private', 'public'] }, rotateInviteLink: { type: 'boolean' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query(
    `UPDATE channels SET title = COALESCE($2,title), description = COALESCE($3,description),
       visibility = COALESCE($4,visibility), invite_token = CASE WHEN $5::boolean THEN encode(gen_random_bytes(24),'hex') ELSE invite_token END
     WHERE id = $1 AND owner_id = $6 RETURNING id,title,username,description,visibility,invite_token`,
    [request.params.id, request.body.title?.trim() || null, request.body.description?.trim() ?? null, request.body.visibility || null, request.body.rotateInviteLink === true, request.userId],
  );
  if (!result.rowCount) throw fail(403, 'channel_owner_required');
  return { channel: result.rows[0] };
}));

app.post('/api/channels/:id/admins', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['username'], properties: { username: { type: 'string', minLength: 3, maxLength: 24, pattern: '^[A-Za-z0-9._]+$' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const user = await client.query('SELECT id FROM lookup_user_card_by_username($1)', [request.body.username]);
  if (!user.rowCount) throw fail(404, 'people_not_available');
  const result = await client.query('SELECT set_channel_admin($1,$2,$3,true) AS updated', [request.userId, request.params.id, user.rows[0].id]);
  if (!result.rows[0]?.updated) throw fail(403, 'channel_owner_required');
  return { adminAdded: true };
}));

app.get('/api/conversations/:id/messages', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query('SELECT id, sender_id, body, created_at, edited_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2', [request.params.id, request.query.limit || 50]);
  return { messages: result.rows.reverse() };
}));

app.post('/api/conversations/:id/messages', { config: { rateLimit: { max: 90, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 10000 } } } } }, async (request, reply) => userTransaction(request.userId, async (client) => {
  const result = await client.query('INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, conversation_id, sender_id, body, created_at', [request.params.id, request.userId, request.body.body.trim()]);
  return reply.code(201).send({ message: result.rows[0] });
}));

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const videoTypes = new Set(['video/mp4', 'video/quicktime']);
const fileTypes = new Set(['application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']);
app.post('/api/media/tickets', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, preHandler: requireSession, schema: { body: { type: 'object', additionalProperties: false, required: ['filename', 'mimeType', 'byteSize', 'kind'], properties: { filename: { type: 'string', minLength: 1, maxLength: 255 }, mimeType: { type: 'string', maxLength: 127 }, byteSize: { type: 'integer', minimum: 1 }, kind: { type: 'string', enum: ['image', 'video', 'file'] } } } } }, async (request, reply) => userTransaction(request.userId, async (client) => {
  const { filename, mimeType, byteSize, kind } = request.body;
  const allowed = kind === 'image' ? imageTypes : kind === 'video' ? videoTypes : fileTypes;
  const maximum = kind === 'image' ? 20 : kind === 'video' ? 100 : 25;
  if (!allowed.has(mimeType) || byteSize > maximum * 1024 * 1024) throw fail(400, 'file_type_or_size_rejected');
  const usage = await client.query("SELECT count(*)::integer AS asset_count, COALESCE(sum(byte_size), 0)::bigint AS total_bytes FROM media_assets WHERE owner_id = $1 AND state IN ('pending_upload', 'quarantined')", [request.userId]);
  if (usage.rows[0].asset_count >= 20 || Number(usage.rows[0].total_bytes) + byteSize > 250 * 1024 * 1024) throw fail(429, 'upload_quota_exceeded');
  const key = `pending/${request.userId}/${randomUUID()}/${cleanFilename(filename)}`;
  const bucket = process.env.S3_BUCKET_QUARANTINE || 'chatwave-quarantine';
  const asset = await client.query('INSERT INTO media_assets (owner_id, kind, bucket_name, object_key, original_filename, declared_mime_type, byte_size, state) VALUES ($1,$2,$3,$4,$5,$6,$7,\'pending_upload\') RETURNING id', [request.userId, kind, bucket, key, cleanFilename(filename), mimeType, byteSize]);
  const ticket = await createPresignedPost(s3, { Bucket: bucket, Key: key, Expires: 300, Fields: { 'Content-Type': mimeType }, Conditions: [['content-length-range', 1, maximum * 1024 * 1024], ['eq', '$Content-Type', mimeType]] });
  return reply.code(201).send({ assetId: asset.rows[0].id, upload: ticket, expiresInSeconds: 300, state: 'pending_upload' });
}));

app.post('/api/media/:id/complete', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query("SELECT id, bucket_name, object_key, byte_size, declared_mime_type FROM media_assets WHERE id = $1 AND owner_id = $2 AND state = 'pending_upload' FOR UPDATE", [request.params.id, request.userId]);
  const asset = result.rows[0];
  if (!asset) throw fail(404, 'upload_not_found');
  const head = await s3.send(new HeadObjectCommand({ Bucket: asset.bucket_name, Key: asset.object_key }));
  if (Number(head.ContentLength) !== Number(asset.byte_size) || head.ContentType !== asset.declared_mime_type) {
    await s3.send(new DeleteObjectCommand({ Bucket: asset.bucket_name, Key: asset.object_key }));
    await client.query('DELETE FROM media_assets WHERE id = $1 AND owner_id = $2', [asset.id, request.userId]);
    throw fail(400, 'uploaded_file_does_not_match_ticket');
  }
  const completed = await client.query('SELECT complete_media_upload($1, $2, $3, $4) AS id', [asset.id, request.userId, asset.byte_size, asset.declared_mime_type]);
  if (!completed.rows[0]?.id) throw fail(409, 'upload_not_found');
  return { assetId: asset.id, state: 'quarantined', note: 'The file remains private until a malware and media-safety scan approves it.' };
}));

app.post('/api/media/:id/cancel', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query("SELECT bucket_name, object_key FROM media_assets WHERE id = $1 AND owner_id = $2 AND state IN ('pending_upload', 'quarantined', 'rejected') FOR UPDATE", [request.params.id, request.userId]);
  if (!result.rowCount) throw fail(404, 'upload_not_found');
  await s3.send(new DeleteObjectCommand({ Bucket: result.rows[0].bucket_name, Key: result.rows[0].object_key }));
  await client.query('DELETE FROM media_assets WHERE id = $1 AND owner_id = $2', [request.params.id, request.userId]);
  return { deleted: true };
}));

app.get('/api/media/:id/url', { preHandler: requireSession, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (request) => userTransaction(request.userId, async (client) => {
  const result = await client.query("SELECT bucket_name, object_key FROM media_assets WHERE id = $1 AND state = 'ready'", [request.params.id]);
  if (!result.rowCount) throw fail(404, 'media_not_available');
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: result.rows[0].bucket_name, Key: result.rows[0].object_key }), { expiresIn: 60 });
  return { url, expiresInSeconds: 60 };
}));

const publicFiles = new Map([
  ['index.html', 'text/html; charset=utf-8'], ['styles.css', 'text/css; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'],
  ['chatwave-mark.png', 'image/png'], ['chatwave-logo.svg', 'image/svg+xml'], ['README.md', 'text/markdown; charset=utf-8'],
  ['TERMS_OF_SERVICE.md', 'text/markdown; charset=utf-8'], ['TERMS_OF_SERVICE_AR.md', 'text/markdown; charset=utf-8'],
  ['PRIVACY_POLICY.md', 'text/markdown; charset=utf-8'], ['PRIVACY_POLICY_AR.md', 'text/markdown; charset=utf-8'],
  ['CHILD_SAFETY_POLICY.md', 'text/markdown; charset=utf-8'], ['CHILD_SAFETY_POLICY_AR.md', 'text/markdown; charset=utf-8'],
]);
async function servePublicFile(file, reply) {
  const mime = publicFiles.get(file);
  if (!mime) return reply.code(404).send({ error: 'not_found' });
  try {
    const content = await readFile(resolve(projectRoot, file));
    reply.type(mime).header('Cache-Control', file === 'index.html' ? 'no-store' : 'public, max-age=300');
    return reply.send(content);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}
app.get('/', async (_request, reply) => servePublicFile('index.html', reply));
app.get('/:file', async (request, reply) => servePublicFile(request.params.file, reply));

app.addHook('onClose', async () => { await pool.end(); s3.destroy(); });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
await app.listen({ port, host });
app.log.info({ host, port, environment: process.env.NODE_ENV || 'development' }, 'ChatWave API is listening');
