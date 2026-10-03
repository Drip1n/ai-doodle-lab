import { randomBytes } from 'node:crypto';

/**
 * Temporary phone handoff for one generated picture.
 *
 * A child at a booth made a picture on a machine that is not theirs, and
 * "Download my picture" saves it to that machine. A QR code fixes that, but a
 * QR code cannot carry a `blob:` or `data:` URL: the phone is a different
 * device. So the picture needs a URL of ours that a phone can open.
 *
 * What this module deliberately is NOT: storage. It holds the bytes in
 * process memory, behind a 256-bit random token, for about half an hour, with
 * a hard ceiling on how many and how much. Nothing is written to disk, the
 * tokens are not derived from anything, and a restart drops every share. The
 * workshop-code store stays the only durable thing on the backend.
 */

export const SHARE_PATH_PREFIX = '/api/shared-image/';

/** 32 random bytes as base64url: 43 characters, 256 bits of entropy. */
const TOKEN_BYTES = 32;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const SHARE_TTL_MS = 30 * 60 * 1000;
export const MAX_SHARE_ENTRIES = 40;
/** One picture. A 1024x1024 PNG from the provider is a couple of megabytes. */
export const MAX_SHARE_BYTES = 8_000_000;
/** Everything held at once, so the ceiling is bytes as well as items. */
export const MAX_SHARE_TOTAL_BYTES = 64_000_000;
/** How long the provider's own image host may take to hand us the copy. */
export const SHARE_FETCH_TIMEOUT_MS = 15_000;

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const SHAREABLE_TYPES = Object.freeze(Object.keys(EXTENSIONS));

export class ShareError extends Error {}

/**
 * The type the bytes actually are, not the one they were announced as. A
 * provider that mislabels its own response, or a URL that answers with
 * something else entirely, must not be able to make us serve an HTML or SVG
 * document from our own origin under an image content type.
 */
export function sniffImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return null;
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** `ai-doodle-flying-cat.png`, matching what the download button produces. */
export function shareFileName(categoryName, contentType) {
  const safe = String(categoryName ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `ai-doodle-${safe || 'picture'}.${EXTENSIONS[contentType] ?? 'png'}`;
}

/**
 * The provider's image host is a public one. A result pointing at loopback,
 * a link-local address or a private range is not a picture we should fetch:
 * the provider response is the one input to this module we do not control,
 * and a server-side fetch can reach places a browser cannot. This blocks the
 * obvious literal-address cases; it is not DNS-rebinding protection, which is
 * why the bytes are still bounded, type-checked and only ever handed back
 * behind the requester's own random token.
 */
function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') return false;
  if (/^::ffff:/.test(host)) return publicHost(host.replace(/^::ffff:/, ''));
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host) && host.includes(':')) return false;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  return true;
}

/** Reads a response body with a hard byte ceiling rather than trusting it. */
async function readBounded(response, maxBytes) {
  const announced = Number(response.headers?.get?.('content-length') ?? '');
  if (Number.isFinite(announced) && announced > maxBytes) throw new ShareError('image too large');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new ShareError('image too large');
    return buffer;
  }
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new ShareError('image too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    // Stop the download as soon as we give up on it, so a hostile or broken
    // host cannot keep pushing bytes at a socket nobody is reading.
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/**
 * The share copy of a generated picture, from either shape the generation
 * adapter can return: an inline `data:` image, or an `https:` URL on the
 * provider's own host.
 *
 * The provider URL is never handed out as our share link -- it is fetched
 * once, bounded and type-checked, and only the bytes are kept. That is one
 * extra image download, never a second generation.
 */
export async function imageForSharing(source, { fetcher = fetch, timeoutMs = SHARE_FETCH_TIMEOUT_MS, maxBytes = MAX_SHARE_BYTES } = {}) {
  if (typeof source !== 'string' || !source) throw new ShareError('no image to share');
  let bytes;
  if (source.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (!match) throw new ShareError('unsupported inline image');
    // Base64 is 4 characters per 3 bytes, so check the cheap bound first and
    // never allocate a buffer for something already over the ceiling.
    if (match[1].length / 4 * 3 > maxBytes) throw new ShareError('image too large');
    bytes = Buffer.from(match[1], 'base64');
  } else {
    const url = new URL(source);
    if (url.protocol !== 'https:') throw new ShareError('insecure image source');
    if (!publicHost(url.hostname)) throw new ShareError('image host is not a public one');
    const response = await fetcher(source, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) throw new ShareError('image host refused');
    const announcedType = (response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (announcedType && !SHAREABLE_TYPES.includes(announcedType)) throw new ShareError('not an image');
    bytes = await readBounded(response, maxBytes);
  }
  if (bytes.length === 0 || bytes.length > maxBytes) throw new ShareError('image too large');
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new ShareError('not an image');
  return { bytes, contentType };
}

/**
 * The bounded in-memory share table. `maxEntries: 0` turns sharing off
 * entirely: `put` refuses and `get` finds nothing.
 */
export function createImageShares({
  ttlMs = SHARE_TTL_MS,
  maxEntries = MAX_SHARE_ENTRIES,
  maxItemBytes = MAX_SHARE_BYTES,
  maxTotalBytes = MAX_SHARE_TOTAL_BYTES,
} = {}) {
  /** Insertion-ordered, which is what makes "evict the oldest" one line. */
  const entries = new Map();
  let totalBytes = 0;

  const drop = (token) => {
    const entry = entries.get(token);
    if (!entry) return;
    entries.delete(token);
    totalBytes -= entry.bytes.length;
  };

  const sweep = (now) => {
    for (const [token, entry] of entries) {
      if (entry.expiresAt > now) break; // insertion order is expiry order
      drop(token);
    }
  };

  const evictOldest = () => {
    const oldest = entries.keys().next();
    if (!oldest.done) drop(oldest.value);
  };

  return {
    /** `{ token, path, expiresAt }` for bytes that are now being held. */
    put({ bytes, contentType, fileName }, now = Date.now()) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ShareError('no image to share');
      if (bytes.length > maxItemBytes || bytes.length > maxTotalBytes) throw new ShareError('image too large');
      if (!SHAREABLE_TYPES.includes(contentType)) throw new ShareError('not an image');
      if (maxEntries === 0) throw new ShareError('sharing is switched off');
      sweep(now);
      while (entries.size >= maxEntries || totalBytes + bytes.length > maxTotalBytes) evictOldest();
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      entries.set(token, { bytes, contentType, fileName, expiresAt: now + ttlMs });
      totalBytes += bytes.length;
      return { token, path: `${SHARE_PATH_PREFIX}${token}`, expiresAt: now + ttlMs };
    },

    /** The held picture, or `null` -- unknown and expired are the same answer. */
    get(token, now = Date.now()) {
      if (typeof token !== 'string' || !SHARE_TOKEN_PATTERN.test(token)) return null;
      sweep(now);
      const entry = entries.get(token);
      if (!entry || entry.expiresAt <= now) return null;
      return entry;
    },

    /** For tests and the health view: never the tokens or the bytes. */
    stats(now = Date.now()) {
      sweep(now);
      return { count: entries.size, bytes: totalBytes };
    },
  };
}
