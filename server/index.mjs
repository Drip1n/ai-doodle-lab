import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { config, generate, HttpError, validateInput } from './generation.mjs';
import {
  checkCode, claimCode, codePrefix, createCodeEntry, MAX_LABEL_LENGTH, publicCode,
} from './codes.mjs';
import { createStore, StoreError, storePath } from './store.mjs';
import {
  clearedCookie, createAdminAuth, parseAdmins, parseCookies, SESSION_COOKIE, sessionCookie,
} from './admin.mjs';
import { AcquireAbortedError, BusyError, createLimiter, createRateLimiter, QueueTimeoutError } from './queue.mjs';
import {
  createImageShares, imageForSharing, MAX_SHARE_ENTRIES, SHARE_PATH_PREFIX, SHARE_TTL_MS, shareFileName,
} from './imageShares.mjs';

const MAX_BODY_BYTES = 3_000_000;
/**
 * Wrong workshop codes allowed per address per minute. A code has ~39 bits of
 * entropy, so this is not what makes guessing hopeless -- it is what stops a
 * guessing loop from being a free way to make the server hash all day. Only
 * failures count, so a whole class using the right code is never affected.
 */
const MAX_CODE_ATTEMPTS = 60;
const CODE_ATTEMPT_WINDOW_MS = 60_000;
const MAX_ADMIN_BODY_BYTES = 4_000;
const REVOKE = /^\/api\/admin\/codes\/([A-Za-z0-9_-]{8,64})\/revoke$/;

function wholeNumber(raw, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (raw === undefined || raw === null || `${raw}`.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Everything the server reads from the environment, validated once at boot. */
export function serverConfig(env = process.env) {
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:5173';
  return {
    provider: config(env),
    origin,
    secureCookies: env.ADMIN_COOKIE_SECURE === '1' || (env.ADMIN_COOKIE_SECURE !== '0' && origin.startsWith('https://')),
    trustProxy: env.TRUST_PROXY === '1',
    prefix: codePrefix(env),
    storePath: storePath(env),
    concurrency: wholeNumber(env.IMAGE_MAX_CONCURRENCY, 4, { min: 1, max: 64 }),
    queueLimit: wholeNumber(env.IMAGE_QUEUE_LIMIT, 20, { min: 0, max: 500 }),
    queueWaitMs: wholeNumber(env.IMAGE_QUEUE_WAIT_MS, 120_000, { min: 0, max: 600_000 }),
    providerTimeoutMs: wholeNumber(env.IMAGE_PROVIDER_TIMEOUT_MS, 90_000, { min: 1_000, max: 600_000 }),
    // The emergency ceiling for the whole process. 0 disables it; a workshop
    // should normally leave it on and rely on per-code limits day to day.
    globalLimit: wholeNumber(env.IMAGE_GLOBAL_REQUEST_LIMIT ?? env.IMAGE_REQUEST_LIMIT, 200, { min: 0, max: 1_000_000 }),
    codeRateLimit: wholeNumber(env.IMAGE_CODE_RATE_LIMIT, 30, { min: 0, max: 10_000 }),
    // The phone-handoff share: how long a QR link works, and how many
    // pictures may be held in memory at once. 0 items switches it off.
    shareTtlMs: wholeNumber(env.IMAGE_SHARE_TTL_MS, SHARE_TTL_MS, { min: 60_000, max: 6 * 60 * 60 * 1000 }),
    shareMaxItems: wholeNumber(env.IMAGE_SHARE_MAX_ITEMS, MAX_SHARE_ENTRIES, { min: 0, max: 500 }),
    codeRateWindowMs: wholeNumber(env.IMAGE_CODE_RATE_WINDOW_MS, 60_000, { min: 1_000, max: 3_600_000 }),
    sessionTtlMs: wholeNumber(env.ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000, { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 }),
    maxFailures: wholeNumber(env.ADMIN_MAX_FAILURES, 5, { min: 1, max: 100 }),
    lockoutMs: wholeNumber(env.ADMIN_LOCKOUT_MS, 15 * 60 * 1000, { min: 1_000, max: 24 * 60 * 60 * 1000 }),
    admins: parseAdmins(env.ADMIN_USERS_JSON || ''),
  };
}

async function readBody(req, limit) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use JSON');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      // Stop reading as well as answering: without this the client keeps
      // pushing megabytes into a socket nobody is draining.
      req.destroy();
      throw new HttpError(413, 'That request is too large.');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid request'); }
}

export function createImageServer({ env = process.env, fetcher = fetch, store, now = () => Date.now() } = {}) {
  const settings = serverConfig(env);
  const codeStore = store ?? createStore(settings.storePath);
  const auth = createAdminAuth({
    admins: settings.admins,
    ttlMs: settings.sessionTtlMs,
    maxFailures: settings.maxFailures,
    lockoutMs: settings.lockoutMs,
    now,
  });
  const limiter = createLimiter({
    concurrency: settings.concurrency,
    queueLimit: settings.queueLimit,
    waitMs: settings.queueWaitMs,
  });
  const codeRate = createRateLimiter({ limit: settings.codeRateLimit, windowMs: settings.codeRateWindowMs });
  const attempts = createRateLimiter({ limit: MAX_CODE_ATTEMPTS, windowMs: CODE_ATTEMPT_WINDOW_MS });
  const shares = createImageShares({ ttlMs: settings.shareTtlMs, maxEntries: settings.shareMaxItems });
  let globalUsed = 0;

  const route = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const reply = (status, body, headers = {}) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const url = (req.url ?? '').split('?')[0];

    /**
     * The phone handoff, deliberately the one route that is not bound to our
     * origin: a child's phone scans the QR code and opens this on a different
     * device, so there is no workshop code and no Origin to match. The random
     * token is the whole capability, it expires, and the route answers the
     * same generic 404 for anything it does not hold. No CORS header is set,
     * so another site's JavaScript still cannot read the bytes.
     */
    if (url.startsWith(SHARE_PATH_PREFIX) && req.method === 'GET') {
      return sendSharedImage(url.slice(SHARE_PATH_PREFIX.length), res, reply);
    }

    const origin = req.headers.origin;
    if (origin && origin !== settings.origin) return reply(403, { error: 'This website is not allowed.' });
    if (origin === settings.origin) {
      res.setHeader('Access-Control-Allow-Origin', settings.origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workshop-Code');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS' && url.startsWith('/api/')) { res.writeHead(204); return res.end(); }


    /** The address used for lockout counting. See TRUST_PROXY in the docs. */
    const clientIp = () => {
      if (settings.trustProxy) {
        const forwarded = req.headers['x-forwarded-for'];
        const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
        if (first) return first;
      }
      return req.socket.remoteAddress ?? 'unknown';
    };

    if (url === '/api/health' && req.method === 'GET') {
      let storeOk = true;
      try { await codeStore.read(); } catch { storeOk = false; }
      return reply(200, {
        status: 'ok',
        configured: Boolean(settings.provider.key && settings.provider.model) && auth.configured() && storeOk,
        adminConfigured: auth.configured(),
        storeReadable: storeOk,
      });
    }

    if (url.startsWith('/api/admin/')) return handleAdmin(url, req, reply, clientIp);
    if (url === '/api/generate-image') return handleGenerate(req, res, reply, clientIp);
    return reply(404, { error: 'Not found' });
  };

  // An unhandled rejection from the request handler would end the process,
  // and a workshop cannot afford that. Nothing about the error reaches the
  // client.
  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error('Unhandled request failure:', error?.message ?? 'unknown');
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Something went wrong. Please try again.' }));
      }
    });
  });
  // Must outlast a full queue wait plus a full provider generation, or Node
  // would cut off a request that is legitimately still working.
  server.requestTimeout = settings.queueWaitMs + settings.providerTimeoutMs + 30_000;
  server.headersTimeout = 60_000;

  /** One wording for every failed sign-in, so the panel reveals no emails. */
  const LOGIN_FAILED = 'Sign-in failed. Check the email and password.';

  async function handleAdmin(url, req, reply, clientIp) {
    // Mutations must carry our exact origin. With SameSite=Strict on the
    // session cookie that is belt and braces, but it is one line of CSRF
    // defence and costs nothing.
    if (req.method === 'POST' && req.headers.origin !== settings.origin) {
      return reply(403, { error: 'This website is not allowed.' });
    }
    if (!auth.configured()) return reply(503, { error: 'Admin access is not configured on this server.' });

    if (url === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req, MAX_ADMIN_BODY_BYTES).catch((error) => error);
      if (body instanceof Error) return reply(body instanceof HttpError ? body.status : 400, { error: LOGIN_FAILED });
      const email = typeof body?.email === 'string' ? body.email.slice(0, 160) : '';
      const password = typeof body?.password === 'string' ? body.password.slice(0, 512) : '';
      const result = await auth.login(email, password, clientIp());
      if (!result.ok) {
        return reply(result.locked ? 429 : 401, {
          error: result.locked ? 'Too many sign-in attempts. Wait a few minutes and try again.' : LOGIN_FAILED,
        });
      }
      return reply(200, { email: result.email }, { 'Set-Cookie': sessionCookie(result.token, { secure: settings.secureCookies, ttlMs: settings.sessionTtlMs }) });
    }

    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);

    if (url === '/api/admin/logout' && req.method === 'POST') {
      auth.logout(token);
      return reply(200, { ok: true }, { 'Set-Cookie': clearedCookie({ secure: settings.secureCookies }) });
    }

    const session = auth.verify(token);
    if (!session) return reply(401, { error: 'Please sign in again.' });

    try {
      if (url === '/api/admin/codes' && req.method === 'GET') {
        const codes = await codeStore.read();
        return reply(200, { email: session.email, codes: codes.map((entry) => publicCode(entry, now())) });
      }

      if (url === '/api/admin/codes' && req.method === 'POST') {
        const body = await readBody(req, MAX_ADMIN_BODY_BYTES);
        const label = typeof body?.label === 'string' ? body.label.trim() : '';
        if (!label || label.length > MAX_LABEL_LENGTH) return reply(400, { error: `Give the code a name of 1-${MAX_LABEL_LENGTH} characters.` });
        let usageLimit;
        let expiresInHours;
        try {
          usageLimit = wholeNumber(body?.usageLimit, 30, { min: 1, max: 5_000 });
          expiresInHours = wholeNumber(body?.expiresInHours, 8, { min: 1, max: 24 * 14 });
        } catch { return reply(400, { error: 'Use a whole-number usage limit and expiry.' }); }
        const created = createCodeEntry({
          label,
          expiresAt: now() + expiresInHours * 3_600_000,
          usageLimit,
          createdBy: session.email,
          prefix: settings.prefix,
          now: now(),
        });
        await codeStore.mutate((codes) => {
          if (codes.length >= 200) throw new HttpError(409, 'Too many workshop codes exist. Revoke some first.');
          codes.push(created.entry);
          return { result: undefined };
        });
        // The only time the plaintext ever leaves this process.
        return reply(201, { code: created.code, entry: publicCode(created.entry, now()) });
      }

      const revoke = REVOKE.exec(url);
      if (revoke && req.method === 'POST') {
        const found = await codeStore.mutate((codes) => {
          const entry = codes.find((candidate) => candidate.id === revoke[1]);
          if (!entry) return { result: null, write: false };
          if (entry.revokedAt === null) entry.revokedAt = now();
          return { result: publicCode(entry, now()), write: true };
        });
        return found ? reply(200, { entry: found }) : reply(404, { error: 'That code no longer exists.' });
      }
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message });
      if (error instanceof StoreError) {
        console.error('Workshop code store unusable:', error.message);
        return reply(503, { error: 'The workshop code store could not be read. Check the server logs.' });
      }
      throw error;
    }
    return reply(404, { error: 'Not found' });
  }

  function sendSharedImage(token, res, reply) {
    const entry = shares.get(token, now());
    // Unknown, malformed and expired are one answer, and it is the same one
    // an unknown path gets.
    if (!entry) return reply(404, { error: 'Not found' });
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(200, {
      'Content-Type': entry.contentType,
      'Content-Length': entry.bytes.length,
      // `inline` so a scanned link shows the picture; the filename is what
      // the phone saves it as.
      'Content-Disposition': `inline; filename="${entry.fileName}"`,
    });
    res.end(entry.bytes);
  }

  /**
   * The share metadata for a picture that has already been generated, or
   * nothing at all. Sharing is an extra: a picture that cannot be copied for
   * the phone is still a picture the child made, so every failure here is
   * swallowed and the generation response goes out without the QR fields.
   */
  async function shareFor(image, categoryName, aborted) {
    if (settings.shareMaxItems === 0 || aborted) return {};
    try {
      const { bytes, contentType } = await imageForSharing(image, { fetcher });
      const { path, expiresAt } = shares.put({ bytes, contentType, fileName: shareFileName(categoryName, contentType) }, now());
      return { sharePath: path, shareExpiresAt: expiresAt };
    } catch {
      // Never logged: the only interesting part of a failure here would be
      // the image or the token.
      return {};
    }
  }

  async function handleGenerate(req, res, reply, clientIp) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return reply(405, { error: 'Use POST' }); }
    const supplied = req.headers['x-workshop-code'];
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    let release = null;
    let providerTimer = null;
    // A reservation against the global ceiling that has not yet turned into a
    // real generation. Handing it back in `finally` is what stops a refused
    // request from permanently eating one of the workshop's pictures.
    let globalReserved = false;
    try {
      const raw = await readBody(req, MAX_BODY_BYTES);
      const input = validateInput(raw);
      if (!settings.provider.key || !settings.provider.model) throw new HttpError(503, 'Picture making is not configured yet.');

      // Cheap, non-spending check first: a wrong or dead code never reaches
      // the queue, let alone the provider.
      const precheck = await checkCode(codeStore, supplied, now());
      if (precheck.state !== 'active') {
        if (!attempts.take(clientIp(), now())) {
          throw new HttpError(429, 'Too many tries with a code that does not work. Wait a moment.', 'rate');
        }
        throw codeProblem(precheck.state);
      }
      if (settings.globalLimit > 0 && globalUsed >= settings.globalLimit) {
        throw new HttpError(429, 'The workshop picture limit has been reached.', 'limit');
      }

      release = await limiter.acquire(controller.signal);

      // With a slot in hand, take the ceilings first and spend the code's
      // usage last, so nothing that is about to be refused costs a picture.
      // The ceiling is reserved synchronously, which is what keeps four
      // concurrent requests from stepping over it together.
      if (settings.globalLimit > 0 && globalUsed >= settings.globalLimit) {
        throw new HttpError(429, 'The workshop picture limit has been reached.', 'limit');
      }
      globalUsed += 1;
      globalReserved = true;
      if (!codeRate.take(precheck.id, now())) {
        throw new HttpError(429, 'That workshop code has made a lot of pictures very quickly. Wait a moment.', 'rate');
      }

      // Re-check and spend only now: the code may have been revoked or used
      // up by another class while this request waited its turn.
      const claim = await claimCode(codeStore, supplied, now());
      if (!claim.ok) throw codeProblem(claim.state);
      // Past this point the picture really is being made, so the reservation
      // is a genuine spend rather than something to hand back.
      globalReserved = false;

      // The provider clock starts here, so time spent queueing never eats
      // into the generation timeout.
      providerTimer = setTimeout(() => controller.abort(), settings.providerTimeoutMs);
      const result = await generate(input, settings.provider, fetcher, controller.signal);
      // The provider is done; its clock must not still be able to abort the
      // share copy that follows.
      clearTimeout(providerTimer);
      providerTimer = null;
      reply(200, { ...result, ...await shareFor(result.image, input.category.name, controller.signal.aborted) });
    } catch (error) {
      if (error instanceof BusyError) {
        return reply(429, { code: 'busy', error: 'Lots of pictures are being made right now. Wait a moment and try again.' });
      }
      if (error instanceof QueueTimeoutError) {
        return reply(503, { code: 'busy', error: 'Lots of pictures are being made right now. Wait a moment and try again.' });
      }
      if (error instanceof AcquireAbortedError) return;
      if (error instanceof StoreError) {
        console.error('Workshop code store unusable:', error.message);
        return reply(503, { error: 'Picture making is not available right now. Ask your teacher.' });
      }
      if (error instanceof HttpError) return reply(error.status, { code: error.code, error: error.message });
      return reply(controller.signal.aborted ? 504 : 502, { error: 'The picture could not be made. Please try again later.' });
    } finally {
      clearTimeout(providerTimer);
      res.off('close', onClose);
      release?.();
      if (globalReserved) globalUsed -= 1;
    }
  }

  /** Children see one wording for "ask your teacher"; the code says why. */
  function codeProblem(state) {
    const messages = {
      unknown: 'Ask your teacher for the workshop code, then try again.',
      revoked: 'That workshop code is no longer in use. Ask your teacher for the new one.',
      expired: 'That workshop code has finished for today. Ask your teacher.',
      exhausted: 'That workshop code has made all of its pictures. Ask your teacher.',
    };
    return new HttpError(state === 'unknown' ? 401 : 403, messages[state] ?? messages.unknown, state);
  }

  return Object.assign(server, { limiter, auth, codeStore, settings, shares });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createImageServer();
  if (!server.auth.configured()) console.warn('ADMIN_USERS_JSON is empty: the admin panel is disabled until it is set.');
  // Easy to miss when upgrading an existing .env.server.local: the single
  // global code is gone, and leaving it set does nothing.
  if (process.env.WORKSHOP_ACCESS_CODE) console.warn('WORKSHOP_ACCESS_CODE is ignored. Workshop codes are now managed in the admin panel.');
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
    console.log(`Image server ready (no secrets logged). Store: ${server.settings.storePath}`);
    console.log(`Concurrency ${server.settings.concurrency}, queue ${server.settings.queueLimit}, global limit ${server.settings.globalLimit || 'off'}.`);
  });
}
