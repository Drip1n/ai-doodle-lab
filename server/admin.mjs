import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/**
 * Admin authentication for the mini panel.
 *
 * Passwords are human-chosen, so they get scrypt with a per-user salt. The
 * allowlist comes from a server-only environment variable; there is no admin
 * signup, no roles and no password reset, because a workshop has one or two
 * teachers and a hash-generating script is cheaper than any of that.
 */
const PARAMS = { N: 16_384, r: 8, p: 1, keylen: 32 };
export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_COOKIE = 'workshop_admin';

export async function hashPassword(password, params = PARAMS) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p });
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function decode(encoded) {
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, salt, key] = parts;
  const numbers = [Number(N), Number(r), Number(p)];
  if (!numbers.every((value) => Number.isInteger(value) && value > 0)) return null;
  if (numbers[0] > 1 << 20 || numbers[1] > 32 || numbers[2] > 16) return null;
  const saltBytes = Buffer.from(salt, 'base64');
  const keyBytes = Buffer.from(key, 'base64');
  if (saltBytes.length < 8 || keyBytes.length < 16) return null;
  return { N: numbers[0], r: numbers[1], p: numbers[2], salt: saltBytes, key: keyBytes };
}

export async function verifyPassword(password, encoded) {
  const parsed = decode(encoded);
  if (!parsed || typeof password !== 'string') return false;
  const key = await scrypt(password, parsed.salt, parsed.key.length, { N: parsed.N, r: parsed.r, p: parsed.p });
  return timingSafeEqual(key, parsed.key);
}

/** Parses `ADMIN_USERS_JSON`. Any malformed entry fails the whole list closed. */
export function parseAdmins(raw) {
  if (!raw || !raw.trim()) return new Map();
  let list;
  try { list = JSON.parse(raw); } catch { throw new Error('ADMIN_USERS_JSON is not valid JSON'); }
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) throw new Error('ADMIN_USERS_JSON must be an array of 1-20 admins');
  const admins = new Map();
  for (const item of list) {
    const email = typeof item?.email === 'string' ? item.email.trim().toLowerCase() : '';
    if (!email || email.length > 160 || !email.includes('@')) throw new Error('ADMIN_USERS_JSON has an entry without a usable email');
    if (!decode(item?.passwordHash)) throw new Error(`ADMIN_USERS_JSON has no valid scrypt passwordHash for ${email}`);
    admins.set(email, { email, passwordHash: item.passwordHash });
  }
  return admins;
}

/** Hash of a throwaway password, so an unknown email still costs one scrypt. */
const DECOY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function createAdminAuth({
  admins = new Map(),
  ttlMs = 8 * 60 * 60 * 1000,
  maxFailures = 5,
  lockoutMs = 15 * 60 * 1000,
  maxSessions = 50,
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();
  const failures = new Map();

  const sweep = () => {
    const time = now();
    for (const [token, session] of sessions) if (session.expiresAt <= time) sessions.delete(token);
    for (const [key, record] of failures) if (record.until <= time) failures.delete(key);
  };

  const keysFor = (email, ip) => [`email:${email}`, `ip:${ip || 'unknown'}`];

  const locked = (email, ip) => {
    const time = now();
    return keysFor(email, ip).some((key) => {
      const record = failures.get(key);
      return Boolean(record) && record.count >= maxFailures && record.until > time;
    });
  };

  const recordFailure = (email, ip) => {
    const until = now() + lockoutMs;
    for (const key of keysFor(email, ip)) {
      const record = failures.get(key);
      if (record && record.until > now()) { record.count += 1; record.until = until; }
      else failures.set(key, { count: 1, until });
    }
    if (failures.size > 2_000) sweep();
  };

  return {
    get sessionCount() { return sessions.size; },
    configured: () => admins.size > 0,
    sweep,
    /** Resolves to a session token, or null. `locked` means stop asking. */
    async login(rawEmail, password, ip) {
      sweep();
      const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
      if (locked(email, ip)) return { ok: false, locked: true };
      const admin = admins.get(email);
      // Always run scrypt, so "unknown email" and "wrong password" take the
      // same time and the panel cannot be used to enumerate teachers.
      const ok = await verifyPassword(password, admin?.passwordHash ?? DECOY) && Boolean(admin);
      if (!ok) { recordFailure(email, ip); return { ok: false, locked: false }; }
      for (const key of keysFor(email, ip)) failures.delete(key);
      if (sessions.size >= maxSessions) {
        const oldest = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
        if (oldest) sessions.delete(oldest[0]);
      }
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { email, expiresAt: now() + ttlMs });
      return { ok: true, token, email, expiresAt: now() + ttlMs };
    },
    verify(token) {
      if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
      const session = sessions.get(token);
      if (!session) return null;
      if (session.expiresAt <= now()) { sessions.delete(token); return null; }
      return { email: session.email };
    },
    logout(token) { return typeof token === 'string' ? sessions.delete(token) : false; },
  };
}

export function parseCookies(header) {
  const jar = new Map();
  if (typeof header !== 'string') return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (name && !jar.has(name)) jar.set(name, part.slice(index + 1).trim());
  }
  return jar;
}

export function sessionCookie(token, { secure, ttlMs }) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(ttlMs / 1000)}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedCookie({ secure }) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
