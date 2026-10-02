import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createImageServer, serverConfig } from './index.mjs';
import { harness, INPUT, ORIGIN, REFERENCE, TEST_EMAIL, TEST_PASSWORD } from './test-helpers.mjs';

const body = (response) => response.json();

/** Signs in and creates one code, which is the start of most of these tests. */
async function withCode(api, overrides = {}) {
  const { cookie } = await api.signIn();
  const response = await api.admin('/codes', {
    method: 'POST', cookie,
    body: { label: 'Workshop Group A', expiresInHours: 8, usageLimit: 30, ...overrides },
  });
  assert.equal(response.status, 201);
  return { cookie, ...await body(response) };
}

test('health reports what is configured without revealing any of it', async () => {
  const api = await harness();
  try {
    const result = await body(await fetch(`${api.base}/api/health`));
    assert.deepEqual(result, { status: 'ok', configured: true, adminConfigured: true, storeReadable: true });
    assert.ok(!JSON.stringify(result).includes('test-only'), 'the provider key never appears');
  } finally { await api.close(); }
});

test('an unconfigured server reports it and never calls a provider', async () => {
  const server = createImageServer({ env: { APP_ORIGIN: ORIGIN }, fetcher: () => { throw Error('must not call a provider'); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await body(await fetch(`${base}/api/health`));
    assert.deepEqual(health, { status: 'ok', configured: false, adminConfigured: false, storeReadable: true });
    const generate = await fetch(`${base}/api/generate-image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Code': 'FONTYS-AAAAAAAA' },
      body: JSON.stringify(INPUT),
    });
    assert.equal(generate.status, 503);
    // Admin routes are closed too, rather than open because nobody set them up.
    assert.equal((await api503(base)).status, 503);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

const api503 = (base) => fetch(`${base}/api/admin/codes`, { headers: { Origin: ORIGIN } });

test('admin routes reject anything without a valid session', async () => {
  const api = await harness();
  try {
    for (const [path, method] of [['/codes', 'GET'], ['/codes', 'POST'], ['/codes/00000000-0000-4000-8000-000000000000/revoke', 'POST']]) {
      const response = await api.admin(path, { method, body: method === 'POST' ? { label: 'x' } : undefined });
      assert.equal(response.status, 401, `${method} ${path} must require a session`);
    }
    for (const forged of ['workshop_admin=forged-token-value-that-is-long-enough', 'workshop_admin=', 'other=1']) {
      assert.equal((await api.admin('/codes', { cookie: forged })).status, 401);
    }
  } finally { await api.close(); }
});

test('sign-in succeeds, sets a hardened cookie, and survives case differences', async () => {
  const api = await harness();
  try {
    const { response, cookie } = await api.signIn(TEST_EMAIL.toUpperCase());
    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { email: TEST_EMAIL });
    const [raw] = response.headers.getSetCookie();
    assert.ok(raw.includes('HttpOnly') && raw.includes('SameSite=Strict') && raw.includes('Path=/'));
    assert.ok(!raw.includes('Secure'), 'local http development is not broken by a Secure cookie');
    assert.ok(!raw.includes(TEST_PASSWORD));
    assert.equal((await api.admin('/codes', { cookie })).status, 200);
  } finally { await api.close(); }
});

test('a wrong password and an unknown email give the same answer', async () => {
  // A high failure budget, so the lockout under test elsewhere does not cut
  // this one short.
  const api = await harness({ env: { ADMIN_MAX_FAILURES: '50' } });
  try {
    const wrong = await api.admin('/login', { method: 'POST', body: { email: TEST_EMAIL, password: 'nope' } });
    const unknown = await api.admin('/login', { method: 'POST', body: { email: 'stranger@example.com', password: TEST_PASSWORD } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await body(wrong), await body(unknown), 'the panel must not reveal which emails exist');
    assert.equal(wrong.headers.getSetCookie().length, 0, 'a failed sign-in sets no cookie');
    for (const junk of [{}, { email: 1, password: 2 }, { email: TEST_EMAIL }, null]) {
      assert.equal((await api.admin('/login', { method: 'POST', body: junk })).status, 401);
    }
  } finally { await api.close(); }
});

test('repeated wrong passwords lock the sign-in out', async () => {
  const api = await harness({ env: { ADMIN_MAX_FAILURES: '3' } });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal((await api.admin('/login', { method: 'POST', body: { email: TEST_EMAIL, password: 'nope' } })).status, 401);
    }
    const locked = await api.admin('/login', { method: 'POST', body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    assert.equal(locked.status, 429, 'the right password is refused while locked out');
    assert.match((await body(locked)).error, /Too many sign-in attempts/);
    assert.equal(locked.headers.getSetCookie().length, 0);
  } finally { await api.close(); }
});

test('logout invalidates the session for good', async () => {
  const api = await harness();
  try {
    const { cookie } = await api.signIn();
    assert.equal((await api.admin('/codes', { cookie })).status, 200);
    const out = await api.admin('/logout', { method: 'POST', cookie });
    assert.equal(out.status, 200);
    assert.ok(out.headers.getSetCookie()[0].includes('Max-Age=0'));
    assert.equal((await api.admin('/codes', { cookie })).status, 401, 'the old cookie is dead');
    // Logging out again, or without a session, is harmless.
    assert.equal((await api.admin('/logout', { method: 'POST', cookie })).status, 200);
    assert.equal((await api.admin('/logout', { method: 'POST' })).status, 200);
  } finally { await api.close(); }
});

test('a code is created once, listed masked, and never shown in full again', async () => {
  const api = await harness();
  try {
    const { cookie, code, entry } = await withCode(api);
    assert.match(code, /^FONTYS-[A-Z2-9]{8}$/);
    assert.equal(entry.label, 'Workshop Group A');
    assert.equal(entry.usageCount, 0);
    assert.equal(entry.usageLimit, 30);
    assert.equal(entry.createdBy, TEST_EMAIL);
    assert.equal(entry.state, 'active');

    const list = await api.admin('/codes', { cookie });
    const payload = await body(list);
    assert.equal(payload.codes.length, 1);
    assert.equal(payload.codes[0].masked, `${code.slice(0, 9)}•••`);
    assert.ok(!JSON.stringify(payload).includes(code), 'the list must never carry the plaintext');
    assert.ok(!JSON.stringify(payload).includes(code.slice(-6)));
    assert.ok(!('codeHash' in payload.codes[0]) && !('salt' in payload.codes[0]));

    // And nothing on disk holds it either.
    const stored = await readFile(api.storeFile, 'utf8');
    assert.ok(!stored.includes(code));
    assert.ok(!stored.includes(TEST_PASSWORD));
  } finally { await api.close(); }
});

test('two codes created in a row are different', async () => {
  const api = await harness();
  try {
    const { cookie } = await api.signIn();
    const codes = new Set();
    for (let round = 0; round < 10; round++) {
      const response = await api.admin('/codes', { method: 'POST', cookie, body: { label: `Group ${round}`, expiresInHours: 4, usageLimit: 5 } });
      codes.add((await body(response)).code);
    }
    assert.equal(codes.size, 10);
  } finally { await api.close(); }
});

test('code creation validates its input', async () => {
  const api = await harness();
  try {
    const { cookie } = await api.signIn();
    for (const payload of [
      {}, { label: '' }, { label: '   ' }, { label: 'a'.repeat(61) },
      { label: 'ok', usageLimit: 0 }, { label: 'ok', usageLimit: -1 }, { label: 'ok', usageLimit: 1.5 },
      { label: 'ok', usageLimit: 99_999 }, { label: 'ok', expiresInHours: 0 }, { label: 'ok', expiresInHours: 10_000 },
      { label: 'ok', usageLimit: 'lots' },
    ]) {
      const response = await api.admin('/codes', { method: 'POST', cookie, body: payload });
      assert.equal(response.status, 400, `must refuse ${JSON.stringify(payload)}`);
    }
    // Sensible defaults when the optional fields are left out.
    const created = await api.admin('/codes', { method: 'POST', cookie, body: { label: 'Defaults' } });
    assert.equal(created.status, 201);
    assert.equal((await body(created)).entry.usageLimit, 30);
  } finally { await api.close(); }
});

test('revoking a code stops it, and revoking twice or revoking nothing is handled', async () => {
  const api = await harness();
  try {
    const { cookie, code, entry } = await withCode(api);
    assert.equal((await api.generate(code)).status, 200);

    const revoked = await api.admin(`/codes/${entry.id}/revoke`, { method: 'POST', cookie });
    assert.equal(revoked.status, 200);
    const revokedEntry = (await body(revoked)).entry;
    assert.equal(revokedEntry.state, 'revoked');

    const blocked = await api.generate(code);
    assert.equal(blocked.status, 403);
    assert.equal((await body(blocked)).code, 'revoked');

    // Idempotent, and the original revocation time is kept.
    const again = await api.admin(`/codes/${entry.id}/revoke`, { method: 'POST', cookie });
    assert.equal((await body(again)).entry.revokedAt, revokedEntry.revokedAt);
    assert.equal((await api.admin('/codes/00000000-0000-4000-8000-000000000000/revoke', { method: 'POST', cookie })).status, 404);
    // A path that is not an id shape is simply not a route.
    assert.equal((await api.admin('/codes/..%2F..%2Fetc%2Fpasswd/revoke', { method: 'POST', cookie })).status, 404);
  } finally { await api.close(); }
});

test('every code state the server can be in produces the right refusal', async () => {
  const api = await harness();
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 1 });
    assert.equal((await api.generate(code)).status, 200);

    const exhausted = await api.generate(code);
    assert.equal(exhausted.status, 403);
    assert.equal((await body(exhausted)).code, 'exhausted');

    const unknown = await api.generate('FONTYS-ZZZZZZZZ');
    assert.equal(unknown.status, 401);
    assert.equal((await body(unknown)).code, 'unknown');

    for (const missing of [undefined, '', 'not a code']) {
      assert.equal((await api.generate(missing)).status, 401);
    }

    // Expiry: a code with a one-hour life, checked against a server whose
    // clock has moved on.
    const soon = await api.admin('/codes', { method: 'POST', cookie, body: { label: 'Short', expiresInHours: 1, usageLimit: 5 } });
    const expiring = (await body(soon)).code;
    const future = await harnessAtTime(api.storeFile, Date.now() + 2 * 3_600_000);
    try {
      const expired = await future.generate(expiring);
      assert.equal(expired.status, 403);
      assert.equal((await body(expired)).code, 'expired');
    } finally { await future.close(); }
  } finally { await api.close(); }
});

/** A second server over the same store file, with its clock moved forward. */
async function harnessAtTime(storeFile, time) {
  const server = createImageServer({
    env: {
      APP_ORIGIN: ORIGIN, WORKSHOP_STORE_PATH: storeFile,
      PORTKEY_API_KEY: 'test-only', PORTKEY_VIRTUAL_KEY: 'route', IMAGE_MODEL: 'model',
    },
    fetcher: async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }),
    now: () => time,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    generate: (code) => fetch(`${base}/api/generate-image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Code': code }, body: JSON.stringify(INPUT),
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('a code and its usage counter survive a server restart', async () => {
  const api = await harness();
  try {
    const { code } = await withCode(api, { usageLimit: 10 });
    assert.equal((await api.generate(code)).status, 200);
    assert.equal((await api.generate(code)).status, 200);
    await api.stop();

    // A fresh server process over the same store file, with no session and no
    // in-memory state at all.
    const restarted = await harnessAtTime(api.storeFile, Date.now());
    try {
      assert.equal((await restarted.generate(code)).status, 200, 'the code still works after a restart');
    } finally { await restarted.close(); }

    const stored = JSON.parse(await readFile(api.storeFile, 'utf8'));
    assert.equal(stored.codes[0].usageCount, 3, 'the counter carried across the restart');
  } finally { await api.close(); }
});

test('a corrupted store fails closed instead of letting everything through', async () => {
  const api = await harness();
  try {
    const { code } = await withCode(api);
    await api.stop();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(api.storeFile, '{"version":1,"codes":[{"id":"broken"}]}');

    const broken = await harnessAtTime(api.storeFile, Date.now());
    try {
      const response = await broken.generate(code);
      assert.equal(response.status, 503, 'no generation happens on a store the server cannot trust');
      assert.doesNotMatch((await body(response)).error, /JSON|malformed|index/, 'and the child is not shown the internals');
    } finally { await broken.close(); }
  } finally { await api.close(); }
});

test('the provider key stays on the server and is never echoed back', async () => {
  let seenHeaders = null;
  const api = await harness({
    fetcher: async (url, options) => {
      seenHeaders = options.headers;
      return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) };
    },
  });
  try {
    const { code } = await withCode(api);
    const response = await api.generate(code);
    assert.equal(response.status, 200);
    assert.equal(seenHeaders['x-portkey-api-key'], 'test-only', 'the key goes to the provider');
    const text = JSON.stringify(await body(response)) + [...response.headers].flat().join(' ');
    assert.ok(!text.includes('test-only'), 'and nowhere near the browser');
  } finally { await api.close(); }
});

test('only the configured origin may talk to the server', async () => {
  const api = await harness();
  try {
    const { code } = await withCode(api);
    const rejected = await api.generate(code, INPUT, { headers: { Origin: 'https://evil.example' } });
    assert.equal(rejected.status, 403);

    const allowed = await api.generate(code, INPUT, { headers: { Origin: ORIGIN } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(allowed.headers.get('vary'), 'Origin');

    // A refused origin gets no CORS grant at all, so a browser cannot read
    // the body even if it wanted to.
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);

    // Admin mutations additionally require the exact origin, which is what
    // stops a cross-site form POST from riding along on the session cookie.
    const { cookie } = await api.signIn();
    assert.equal((await api.admin('/codes', { method: 'POST', cookie, origin: null, body: { label: 'CSRF' } })).status, 403);
    assert.equal((await api.admin('/login', { method: 'POST', origin: null, body: { email: TEST_EMAIL, password: TEST_PASSWORD } })).status, 403);
  } finally { await api.close(); }
});

test('malformed and oversized generation requests are refused before any provider call', async () => {
  let calls = 0;
  const api = await harness({ fetcher: async () => { calls += 1; return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }; } });
  try {
    const { code } = await withCode(api);
    for (const invalid of [
      { ...INPUT, references: [] },
      { ...INPUT, references: ['https://example.com/a.png'] },
      { ...INPUT, references: Array.from({ length: 5 }, () => REFERENCE) },
      { ...INPUT, references: [`data:image/png;base64,${Buffer.alloc(24).toString('base64')}`] },
      { ...INPUT, idea: 'a'.repeat(181) },
      { ...INPUT, idea: '' },
      { ...INPUT, style: 'photoreal-ultra' },
      { ...INPUT, category: { id: 'x', name: 'a'.repeat(61) } },
      null, 'a string', 42,
    ]) {
      assert.equal((await api.generate(code, invalid)).status, 400, `must refuse ${JSON.stringify(invalid)?.slice(0, 50)}`);
    }

    // Wrong content type and a body that is not JSON at all.
    assert.equal((await fetch(`${api.base}/api/generate-image`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Workshop-Code': code }, body: 'hello',
    })).status, 415);
    assert.equal((await fetch(`${api.base}/api/generate-image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Code': code }, body: '{oops',
    })).status, 400);

    assert.equal(calls, 0, 'not one invalid request reached the provider');
    // And none of them spent a usage.
    const { cookie } = await api.signIn();
    assert.equal((await body(await api.admin('/codes', { cookie }))).codes[0].usageCount, 0);
  } finally { await api.close(); }
});

test('an over-large body is cut off rather than buffered into memory', async () => {
  let calls = 0;
  const api = await harness({ fetcher: async () => { calls += 1; return { ok: true, json: async () => ({}) }; } });
  try {
    const { code } = await withCode(api);
    // Raw http, because the server stops reading and answers mid-upload: the
    // client seeing a reset is a pass, not a flake.
    const outcome = await new Promise((resolve) => {
      const call = httpRequest(`${api.base}/api/generate-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Code': code },
      }, (response) => { response.resume(); resolve(response.statusCode); });
      call.on('error', () => resolve('connection closed'));
      call.write(`{"idea":"x","references":["${'A'.repeat(3_100_000)}"]}`);
      call.end();
    });
    assert.ok([413, 'connection closed'].includes(outcome), `unexpected outcome: ${outcome}`);
    assert.equal(calls, 0, 'nothing reached the provider');
  } finally { await api.close(); }
});

test('other methods and unknown paths are closed', async () => {
  const api = await harness();
  try {
    assert.equal((await fetch(`${api.base}/api/generate-image`, { headers: { Origin: ORIGIN } })).status, 405);
    assert.equal((await fetch(`${api.base}/api/nope`, { headers: { Origin: ORIGIN } })).status, 404);
    assert.equal((await fetch(`${api.base}/`, { headers: { Origin: ORIGIN } })).status, 404);
    const preflight = await fetch(`${api.base}/api/generate-image`, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
    // Caching a workshop code response would be a nasty surprise.
    assert.equal((await fetch(`${api.base}/api/health`)).headers.get('cache-control'), 'no-store');
  } finally { await api.close(); }
});

test('four generations run at once, the fifth waits, and the queue is bounded', async () => {
  let inFlight = 0;
  let peak = 0;
  const gate = { release: null };
  const waitForGate = new Promise((resolve) => { gate.release = resolve; });
  const api = await harness({
    env: { IMAGE_MAX_CONCURRENCY: '4', IMAGE_QUEUE_LIMIT: '2', IMAGE_CODE_RATE_LIMIT: '0' },
    fetcher: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await waitForGate;
      inFlight -= 1;
      return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) };
    },
  });
  try {
    const { code } = await withCode(api, { usageLimit: 100 });
    const running = Array.from({ length: 6 }, () => api.generate(code));
    await delay(150);
    assert.equal(inFlight, 4, 'exactly four provider calls are open');
    assert.equal(api.server.limiter.active, 4);
    assert.equal(api.server.limiter.queued, 2, 'the other two are waiting their turn');

    // A seventh request has nowhere to wait and is told so, politely.
    const busy = await api.generate(code);
    assert.equal(busy.status, 429);
    const payload = await body(busy);
    assert.equal(payload.code, 'busy');
    assert.match(payload.error, /Lots of pictures are being made right now/);
    assert.doesNotMatch(payload.error, /queue|concurrency|provider/i, 'no backend wording reaches a child');

    gate.release();
    const responses = await Promise.all(running);
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200, 200]);
    assert.equal(peak, 4, 'the provider never saw a fifth simultaneous call');
    assert.equal(api.server.limiter.active, 0, 'every slot came back');
    assert.equal(api.server.limiter.queued, 0);
  } finally { gate.release(); await api.close(); }
});

test('concurrent generations spend exactly one usage each, and never more than the limit', async () => {
  const api = await harness({ env: { IMAGE_MAX_CONCURRENCY: '4', IMAGE_QUEUE_LIMIT: '20', IMAGE_CODE_RATE_LIMIT: '0' } });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 6 });
    const responses = await Promise.all(Array.from({ length: 15 }, () => api.generate(code)));
    const statuses = responses.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 200).length, 6, 'exactly the usage limit succeeded');
    assert.ok(statuses.filter((status) => status !== 200).every((status) => status === 403));

    const entry = (await body(await api.admin('/codes', { cookie }))).codes[0];
    assert.equal(entry.usageCount, 6, 'no over-count under concurrency');
    assert.equal(entry.state, 'exhausted');
  } finally { await api.close(); }
});

test('a provider failure releases the slot but still counts the attempt', async () => {
  let calls = 0;
  const api = await harness({
    env: { IMAGE_MAX_CONCURRENCY: '2', IMAGE_CODE_RATE_LIMIT: '0' },
    fetcher: async () => { calls += 1; return calls <= 4 ? { ok: false, status: 500 } : { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }; },
  });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 30 });
    const failures = await Promise.all(Array.from({ length: 4 }, () => api.generate(code)));
    assert.deepEqual(failures.map((response) => response.status), [502, 502, 502, 502]);
    assert.equal(api.server.limiter.active, 0, 'four provider failures leaked no slots');

    // The workshop can keep going straight away.
    assert.equal((await api.generate(code)).status, 200);
    const entry = (await body(await api.admin('/codes', { cookie }))).codes[0];
    // A call that reached the provider is a call that may have been billed,
    // so it counts. That is the deliberate, documented choice.
    assert.equal(entry.usageCount, 5);
  } finally { await api.close(); }
});

test('a client that disconnects while queued frees its place without being counted', async () => {
  const gate = { release: null };
  const waitForGate = new Promise((resolve) => { gate.release = resolve; });
  const api = await harness({
    env: { IMAGE_MAX_CONCURRENCY: '1', IMAGE_QUEUE_LIMIT: '5', IMAGE_CODE_RATE_LIMIT: '0' },
    fetcher: async () => { await waitForGate; return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }; },
  });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 30 });
    const first = api.generate(code);
    await delay(100);
    assert.equal(api.server.limiter.active, 1);

    const controller = new AbortController();
    const abandoned = api.generate(code, INPUT, { signal: controller.signal });
    await delay(100);
    assert.equal(api.server.limiter.queued, 1);

    controller.abort();
    await abandoned.catch(() => {});
    await delay(150);
    assert.equal(api.server.limiter.queued, 0, 'the abandoned request left the queue');

    gate.release();
    assert.equal((await first).status, 200);
    await delay(50);
    assert.equal(api.server.limiter.active, 0, 'and no slot was stranded');
    assert.equal((await body(await api.admin('/codes', { cookie }))).codes[0].usageCount, 1, 'only the request that ran was counted');
  } finally { gate.release(); await api.close(); }
});

test('a request that waits too long for a slot fails gracefully, unqueued and uncounted', async () => {
  const gate = { release: null };
  const waitForGate = new Promise((resolve) => { gate.release = resolve; });
  const api = await harness({
    env: { IMAGE_MAX_CONCURRENCY: '1', IMAGE_QUEUE_LIMIT: '5', IMAGE_QUEUE_WAIT_MS: '150', IMAGE_CODE_RATE_LIMIT: '0' },
    fetcher: async () => { await waitForGate; return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }; },
  });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 30 });
    const first = api.generate(code);
    await delay(80);
    const timedOut = await api.generate(code);
    assert.equal(timedOut.status, 503);
    assert.equal((await body(timedOut)).code, 'busy');
    assert.equal(api.server.limiter.queued, 0);
    gate.release();
    assert.equal((await first).status, 200);
    assert.equal((await body(await api.admin('/codes', { cookie }))).codes[0].usageCount, 1);
  } finally { gate.release(); await api.close(); }
});

test('the global ceiling stops the process regardless of per-code limits', async () => {
  const api = await harness({ env: { IMAGE_GLOBAL_REQUEST_LIMIT: '2', IMAGE_CODE_RATE_LIMIT: '0' } });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 500 });
    assert.equal((await api.generate(code)).status, 200);
    assert.equal((await api.generate(code)).status, 200);
    const stopped = await api.generate(code);
    assert.equal(stopped.status, 429);
    assert.equal((await body(stopped)).code, 'limit');

    // A brand-new code does not reset the ceiling.
    const fresh = await api.admin('/codes', { method: 'POST', cookie, body: { label: 'Group B', usageLimit: 50 } });
    assert.equal((await api.generate((await body(fresh)).code)).status, 429);
    // And the ceiling did not spend the new code's budget.
    const codes = (await body(await api.admin('/codes', { cookie }))).codes;
    assert.equal(codes.find((entry) => entry.label === 'Group B').usageCount, 0);
  } finally { await api.close(); }
});

test('a request refused by the ceiling after queueing does not spend a usage', async () => {
  const gate = { release: null };
  const waitForGate = new Promise((resolve) => { gate.release = resolve; });
  const api = await harness({
    // Concurrency 1 and a ceiling of 2, so the third request passes the
    // cheap check on arrival and only meets the ceiling once its turn comes.
    env: { IMAGE_MAX_CONCURRENCY: '1', IMAGE_QUEUE_LIMIT: '5', IMAGE_GLOBAL_REQUEST_LIMIT: '2', IMAGE_CODE_RATE_LIMIT: '0' },
    fetcher: async () => { await waitForGate; return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }; },
  });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 50 });
    const first = api.generate(code);
    await delay(100);
    const queued = [api.generate(code), api.generate(code)];
    await delay(100);
    assert.equal(api.server.limiter.queued, 2);

    gate.release();
    const statuses = [(await first).status, ...(await Promise.all(queued)).map((response) => response.status)];
    assert.deepEqual(statuses, [200, 200, 429], 'the third meets the ceiling after waiting its turn');

    const entry = (await body(await api.admin('/codes', { cookie }))).codes[0];
    assert.equal(entry.usageCount, 2, 'the refused request cost the class nothing');
  } finally { gate.release(); await api.close(); }
});

test('the per-code burst ceiling slows a script without stopping a class', async () => {
  const api = await harness({ env: { IMAGE_CODE_RATE_LIMIT: '3', IMAGE_CODE_RATE_WINDOW_MS: '60000', IMAGE_MAX_CONCURRENCY: '1' } });
  try {
    const { cookie, code } = await withCode(api, { usageLimit: 50 });
    const other = await api.admin('/codes', { method: 'POST', cookie, body: { label: 'Group B', usageLimit: 50 } });
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await api.generate(code)).status, 200);
    const limited = await api.generate(code);
    assert.equal(limited.status, 429);
    assert.equal((await body(limited)).code, 'rate');
    // The other class is untouched: one group's burst must not punish another.
    assert.equal((await api.generate((await body(other)).code)).status, 200);
  } finally { await api.close(); }
});

test('nothing sensitive is logged while a picture is made', async () => {
  const written = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ['log', 'warn', 'error']) console[level] = (...args) => written.push(args.join(' '));
  const api = await harness();
  try {
    const { code } = await withCode(api);
    await api.generate(code);
    await api.generate('FONTYS-ZZZZZZZZ');
    const log = written.join('\n');
    for (const secret of [code, TEST_PASSWORD, 'test-only', REFERENCE]) {
      assert.ok(!log.includes(secret), `the log must not contain ${secret.slice(0, 12)}`);
    }
  } finally {
    Object.assign(console, original);
    await api.close();
  }
});

test('a guessing loop is throttled, while the right code keeps working', async () => {
  let calls = 0;
  const api = await harness({ fetcher: async () => { calls += 1; return { ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }; } });
  try {
    const { code } = await withCode(api);
    const statuses = [];
    for (let attempt = 0; attempt < 62; attempt++) {
      statuses.push((await api.generate(`FONTYS-${String(attempt).padStart(8, 'A')}`)).status);
    }
    assert.equal(statuses.filter((status) => status === 401).length, 60, 'sixty wrong codes are simply refused');
    assert.ok(statuses.slice(-2).every((status) => status === 429), 'then the address is throttled');
    // The real code is untouched: only failures are counted.
    assert.equal((await api.generate(code)).status, 200);
    assert.equal(calls, 1, 'not one guess reached the provider');
  } finally { await api.close(); }
});

test('an unexpected internal failure answers 500 and the server keeps serving', async () => {
  // A store that breaks in a way the server does not model, which is the
  // case that used to take the whole process down with it.
  const broken = {
    path: '/dev/null',
    read: async () => { throw new TypeError('something nobody planned for'); },
    mutate: async () => { throw new TypeError('something nobody planned for'); },
    reload: async () => {},
  };
  const server = createImageServer({
    env: {
      APP_ORIGIN: ORIGIN,
      ADMIN_USERS_JSON: JSON.stringify([{ email: TEST_EMAIL, passwordHash: await (await import('./admin.mjs')).hashPassword(TEST_PASSWORD) }]),
      PORTKEY_API_KEY: 'test-only', PORTKEY_VIRTUAL_KEY: 'route', IMAGE_MODEL: 'model',
    },
    store: broken,
    fetcher: async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const response = await fetch(`${base}/api/admin/codes`, { headers: { Origin: ORIGIN, Cookie: cookie } });
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), { error: 'Something went wrong. Please try again.' }, 'no internals reach the client');

    // Still alive, which is the whole point.
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/admin/codes`, { headers: { Origin: ORIGIN, Cookie: cookie } })).status, 500);
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the request timeout outlasts a full queue wait plus a full generation', async () => {
  const api = await harness({ env: { IMAGE_QUEUE_WAIT_MS: '100000', IMAGE_PROVIDER_TIMEOUT_MS: '80000' } });
  try {
    assert.ok(api.server.requestTimeout > 100_000 + 80_000, 'otherwise Node cuts off a request that is still working');
    assert.ok(api.server.headersTimeout > 0);
  } finally { await api.close(); }
});

test('configuration is validated at boot rather than failing mid-workshop', () => {
  const defaults = serverConfig({});
  assert.equal(defaults.concurrency, 4);
  assert.equal(defaults.queueLimit, 20);
  assert.equal(defaults.queueWaitMs, 120_000);
  assert.equal(defaults.providerTimeoutMs, 90_000);
  assert.equal(defaults.globalLimit, 200);
  assert.equal(defaults.codeRateLimit, 30);
  assert.equal(defaults.secureCookies, false);
  assert.equal(defaults.trustProxy, false);
  assert.equal(serverConfig({ APP_ORIGIN: 'https://lab.example' }).secureCookies, true, 'https means Secure cookies');
  assert.equal(serverConfig({ IMAGE_GLOBAL_REQUEST_LIMIT: '0' }).globalLimit, 0, 'zero turns the ceiling off');
  assert.equal(serverConfig({ IMAGE_REQUEST_LIMIT: '7' }).globalLimit, 7, 'the old variable name still works');

  for (const env of [
    { IMAGE_MAX_CONCURRENCY: '0' }, { IMAGE_MAX_CONCURRENCY: '-2' }, { IMAGE_MAX_CONCURRENCY: 'four' },
    { IMAGE_QUEUE_LIMIT: '-1' }, { IMAGE_QUEUE_WAIT_MS: '99999999' }, { IMAGE_PROVIDER_TIMEOUT_MS: '10' },
    { ADMIN_SESSION_TTL_MS: '5' }, { ADMIN_USERS_JSON: 'not json' },
    { ADMIN_USERS_JSON: '[{"email":"a@b.c","passwordHash":"plaintext"}]' },
  ]) {
    assert.throws(() => serverConfig(env), Error, `must refuse ${JSON.stringify(env)}`);
  }
});
