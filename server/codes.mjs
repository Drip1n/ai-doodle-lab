import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Workshop/class codes.
 *
 * A code is a high-entropy random string, so the store keeps only
 * `sha256(salt || code)`. There is no reason for a slow KDF here: there is no
 * low-entropy secret to protect, and the hash is checked on the hot path of
 * every generation request. The plaintext exists exactly once, in the HTTP
 * response that created it.
 *
 * The alphabet drops I, L, O, U, 0 and 1 so a code read aloud to a room of
 * children cannot be mistyped into a different valid code.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const BODY_LENGTH = 8;
/** Largest multiple of the alphabet size that fits in a byte, for unbiased sampling. */
const CEILING = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
/** How much of the code an authenticated admin may see again afterwards. */
const VISIBLE_BODY = 2;

export const MAX_CODE_LENGTH = 128;
export const MAX_LABEL_LENGTH = 60;

export function codePrefix(env = process.env) {
  const prefix = (env.WORKSHOP_CODE_PREFIX || 'FONTYS').toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(prefix) ? prefix : 'FONTYS';
}

/** Rejection-sampled so every character is equally likely. */
export function randomCodeBody(length = BODY_LENGTH) {
  let body = '';
  while (body.length < length) {
    for (const byte of randomBytes((length - body.length) * 2)) {
      if (byte >= CEILING) continue;
      body += ALPHABET[byte % ALPHABET.length];
      if (body.length === length) break;
    }
  }
  return body;
}

/** Codes are read aloud, so matching ignores case and surrounding space. */
export function normaliseCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return code.length > 0 && code.length <= MAX_CODE_LENGTH && /^[\x21-\x7E]+$/.test(code) ? code : '';
}

function digest(code, salt) {
  return createHash('sha256').update(salt, 'base64').update(code, 'utf8').digest();
}

export function createCodeEntry({ label, expiresAt, usageLimit, createdBy, prefix = 'FONTYS', now = Date.now() }) {
  const body = randomCodeBody();
  const code = `${prefix}-${body}`;
  const salt = randomBytes(16).toString('base64');
  return {
    code,
    entry: {
      id: randomUUID(),
      label,
      codeHash: digest(code, salt).toString('base64'),
      salt,
      prefix: `${prefix}-${body.slice(0, VISIBLE_BODY)}`,
      createdAt: now,
      expiresAt,
      revokedAt: null,
      usageCount: 0,
      usageLimit,
      createdBy,
    },
  };
}

export function maskedCode(entry) {
  return `${entry.prefix}•••`;
}

export function codeState(entry, now = Date.now()) {
  if (!entry) return 'unknown';
  if (entry.revokedAt !== null) return 'revoked';
  if (entry.expiresAt !== null && entry.expiresAt <= now) return 'expired';
  if (entry.usageCount >= entry.usageLimit) return 'exhausted';
  return 'active';
}

/**
 * Compares against every entry without an early return, so the time taken
 * does not reveal which code — or how many codes — exist.
 */
export function findCode(entries, provided) {
  const code = normaliseCode(provided);
  if (!code) return null;
  let found = null;
  for (const entry of entries) {
    const expected = Buffer.from(entry.codeHash, 'base64');
    const actual = digest(code, entry.salt);
    const same = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (same && !found) found = entry;
  }
  return found;
}

/** What an authenticated admin is allowed to see about a code. */
export function publicCode(entry, now = Date.now()) {
  return {
    id: entry.id,
    label: entry.label,
    masked: maskedCode(entry),
    createdAt: new Date(entry.createdAt).toISOString(),
    expiresAt: entry.expiresAt === null ? null : new Date(entry.expiresAt).toISOString(),
    revokedAt: entry.revokedAt === null ? null : new Date(entry.revokedAt).toISOString(),
    usageCount: entry.usageCount,
    usageLimit: entry.usageLimit,
    createdBy: entry.createdBy,
    state: codeState(entry, now),
  };
}

/**
 * Reads a code's state without spending usage. Used to reject a bad code
 * before the request ever reaches the queue or the provider.
 */
export async function checkCode(store, provided, now = Date.now()) {
  const codes = await store.read();
  const entry = findCode(codes, provided);
  return { state: codeState(entry, now), id: entry?.id ?? null };
}

/**
 * Spends one usage, atomically. Called at the moment a provider generation is
 * about to start -- not when the request arrives -- so a rejected, queued or
 * abandoned request never costs a class one of its pictures. The limit is
 * re-checked inside the serialised section, which is what keeps fifteen
 * concurrent requests from pushing a code past its limit.
 */
export async function claimCode(store, provided, now = Date.now()) {
  return store.mutate((codes) => {
    const entry = findCode(codes, provided);
    const state = codeState(entry, now);
    if (state !== 'active') return { result: { ok: false, state }, write: false };
    entry.usageCount += 1;
    return { result: { ok: true, state, id: entry.id, usageCount: entry.usageCount }, write: true };
  });
}
