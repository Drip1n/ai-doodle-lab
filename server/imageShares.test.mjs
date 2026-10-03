import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createImageShares, imageForSharing, MAX_SHARE_BYTES, SHARE_PATH_PREFIX, SHARE_TOKEN_PATTERN,
  ShareError, shareFileName, sniffImageType,
} from './imageShares.mjs';

/** Real magic bytes, which is all the sniffer inspects. */
function png(size = 64) {
  const bytes = Buffer.alloc(Math.max(size, 16));
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12);
  return bytes;
}
function jpeg(size = 64) {
  const bytes = Buffer.alloc(Math.max(size, 16));
  Buffer.from('ffd8ff', 'hex').copy(bytes);
  return bytes;
}
function webp(size = 64) {
  const bytes = Buffer.alloc(Math.max(size, 16));
  bytes.write('RIFF', 0);
  bytes.write('WEBP', 8);
  return bytes;
}

const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;

/** A fetch-shaped response whose body arrives through a reader, as fetch's does. */
function imageResponse(bytes, { type = 'image/png', ok = true, length } = {}) {
  return {
    ok,
    headers: new Headers({
      'content-type': type,
      'content-length': String(length ?? bytes.length),
    }),
    body: new Blob([bytes]).stream(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
}

test('a share token is 256 random bits, and two shares never collide', () => {
  const shares = createImageShares();
  const seen = new Set();
  for (let index = 0; index < 200; index++) {
    const { token, path, expiresAt } = shares.put({ bytes: png(), contentType: 'image/png', fileName: 'ai-doodle-cat.png' }, 1_000);
    assert.match(token, SHARE_TOKEN_PATTERN);
    assert.equal(path, `${SHARE_PATH_PREFIX}${token}`);
    assert.equal(expiresAt, 1_000 + 30 * 60 * 1000);
    // No workshop code, category or timestamp is recoverable from the token.
    assert.ok(!token.includes('cat'));
    seen.add(token);
  }
  assert.equal(seen.size, 200);
});

test('a held picture comes back, and expiry makes it indistinguishable from a wrong token', () => {
  const shares = createImageShares({ ttlMs: 60_000 });
  const { token } = shares.put({ bytes: png(32), contentType: 'image/png', fileName: 'ai-doodle-cat.png' }, 0);
  const entry = shares.get(token, 59_999);
  assert.equal(entry.contentType, 'image/png');
  assert.equal(entry.fileName, 'ai-doodle-cat.png');
  assert.deepEqual(entry.bytes, png(32));
  // Expired, unknown, malformed and empty all answer the same way.
  assert.equal(shares.get(token, 60_000), null);
  assert.equal(shares.get('a'.repeat(43), 0), null);
  assert.equal(shares.get('too-short', 0), null);
  assert.equal(shares.get('', 0), null);
  assert.equal(shares.get(undefined, 0), null);
  // And the expired entry is gone, not just hidden.
  assert.deepEqual(shares.stats(60_000), { count: 0, bytes: 0 });
});

test('expired entries are swept and the oldest are evicted when the table is full', () => {
  const shares = createImageShares({ ttlMs: 10_000, maxEntries: 3 });
  const first = shares.put({ bytes: png(), contentType: 'image/png', fileName: 'a.png' }, 0);
  const second = shares.put({ bytes: png(), contentType: 'image/png', fileName: 'b.png' }, 1);
  const third = shares.put({ bytes: png(), contentType: 'image/png', fileName: 'c.png' }, 2);
  assert.equal(shares.stats(3).count, 3);

  // A fourth share pushes the oldest out rather than growing the table.
  const fourth = shares.put({ bytes: png(), contentType: 'image/png', fileName: 'd.png' }, 3);
  assert.equal(shares.stats(3).count, 3);
  assert.equal(shares.get(first.token, 3), null);
  assert.ok(shares.get(second.token, 3));
  assert.ok(shares.get(fourth.token, 3));

  // And time alone empties it, without any further put.
  assert.deepEqual(shares.stats(20_000), { count: 0, bytes: 0 });
  assert.equal(shares.get(third.token, 20_000), null);
});

test('the table is bounded in bytes as well as items', () => {
  const shares = createImageShares({ maxEntries: 50, maxItemBytes: 1_000, maxTotalBytes: 2_500 });
  const kept = [];
  for (let index = 0; index < 5; index++) {
    kept.push(shares.put({ bytes: png(1_000), contentType: 'image/png', fileName: 'a.png' }, index).token);
  }
  const stats = shares.stats(5);
  assert.equal(stats.count, 2, 'two 1000-byte pictures fit under a 2500-byte ceiling');
  assert.equal(stats.bytes, 2_000);
  assert.equal(shares.get(kept[0], 5), null);
  assert.ok(shares.get(kept[4], 5));

  // Anything over the per-item ceiling is refused outright.
  assert.throws(() => shares.put({ bytes: png(1_001), contentType: 'image/png', fileName: 'a.png' }, 6), ShareError);
  assert.throws(() => shares.put({ bytes: Buffer.alloc(0), contentType: 'image/png', fileName: 'a.png' }, 6), ShareError);
  assert.throws(() => shares.put({ bytes: png(), contentType: 'image/svg+xml', fileName: 'a.svg' }, 6), ShareError);
});

test('maxEntries 0 switches phone sharing off entirely', () => {
  const shares = createImageShares({ maxEntries: 0 });
  assert.throws(() => shares.put({ bytes: png(), contentType: 'image/png', fileName: 'a.png' }), ShareError);
  assert.deepEqual(shares.stats(), { count: 0, bytes: 0 });
});

test('an inline data image becomes share bytes without any fetch', async () => {
  const fetcher = () => { throw new Error('must not fetch a data URL'); };
  for (const [bytes, type] of [[png(), 'image/png'], [jpeg(), 'image/jpeg'], [webp(), 'image/webp']]) {
    const share = await imageForSharing(dataUrl(bytes, type), { fetcher });
    assert.equal(share.contentType, type);
    assert.deepEqual(share.bytes, bytes);
  }
});

test('an https provider image is fetched once, bounded and type-checked', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, hasSignal: Boolean(options.signal) });
    return imageResponse(png(128));
  };
  const share = await imageForSharing('https://images.example/picture.png', { fetcher });
  assert.equal(share.contentType, 'image/png');
  assert.equal(share.bytes.length, 128);
  assert.deepEqual(calls, [{ url: 'https://images.example/picture.png', method: 'GET', hasSignal: true }]);
});

test('the share copy refuses anything that is not a bounded image', async () => {
  const cases = [
    ['http://images.example/a.png', async () => imageResponse(png())],
    ['https://images.example/a.png', async () => imageResponse(png(), { ok: false })],
    ['https://images.example/a.html', async () => imageResponse(Buffer.from('<html>hello</html>'), { type: 'text/html' })],
    // Announced as an image, but the bytes are not one: the sniffer decides.
    ['https://images.example/a.png', async () => imageResponse(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { type: 'image/png' })],
    // Over the ceiling, both as announced and as actually delivered.
    ['https://images.example/a.png', async () => imageResponse(png(64), { length: MAX_SHARE_BYTES + 1 })],
    ['https://images.example/a.png', async () => imageResponse(png(2_048), { length: 10 })],
    ['data:image/svg+xml;base64,YQ==', async () => imageResponse(png())],
    ['data:image/png;base64,!!!!', async () => imageResponse(png())],
    ['not a url at all', async () => imageResponse(png())],
  ];
  for (const [source, fetcher] of cases) {
    await assert.rejects(
      imageForSharing(source, { fetcher, maxBytes: source.includes('a.png') ? 1_024 : MAX_SHARE_BYTES }),
      (error) => error instanceof Error,
      `${source} must not become a share`,
    );
  }
  // An empty image is nothing to share either.
  await assert.rejects(imageForSharing(''), ShareError);
  await assert.rejects(imageForSharing(null), ShareError);
});

test('an image result pointing inside the network is refused before any fetch', async () => {
  const fetcher = () => { throw new Error('must not fetch an internal address'); };
  for (const host of [
    'localhost', '127.0.0.1', '0.0.0.0', '10.1.2.3', '192.168.1.5', '172.16.0.9', '172.31.255.1',
    '169.254.169.254', '100.64.0.1', '[::1]', '[fd00::1]', '[fe80::1]', 'app.localhost',
  ]) {
    await assert.rejects(imageForSharing(`https://${host}/picture.png`, { fetcher }), ShareError, `${host} must be refused`);
  }
  // Ordinary public hosts, including ones that merely look similar, still work.
  for (const host of ['images.example', '172.32.0.1', '11.0.0.1', '192.167.1.1']) {
    const share = await imageForSharing(`https://${host}/a.png`, { fetcher: async () => imageResponse(png()) });
    assert.equal(share.contentType, 'image/png');
  }
});

test('a slow image host cannot hold a share open forever', async () => {
  const fetcher = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason));
  });
  await assert.rejects(imageForSharing('https://images.example/slow.png', { fetcher, timeoutMs: 20 }));
});

test('a share filename is safe on every platform and matches the download name', () => {
  assert.equal(shareFileName('Cat', 'image/png'), 'ai-doodle-cat.png');
  assert.equal(shareFileName('Flying Café', 'image/jpeg'), 'ai-doodle-flying-cafe.jpg');
  assert.equal(shareFileName('../../etc/passwd', 'image/png'), 'ai-doodle-etc-passwd.png');
  assert.equal(shareFileName('"; rm -rf /', 'image/webp'), 'ai-doodle-rm-rf.webp');
  assert.equal(shareFileName('', 'image/png'), 'ai-doodle-picture.png');
  assert.equal(shareFileName('x'.repeat(80), 'image/png'), `ai-doodle-${'x'.repeat(40)}.png`);
  for (const name of ['Cat', 'Flying Café', '../../etc/passwd', '"; rm -rf /', '']) {
    assert.match(shareFileName(name, 'image/png'), /^ai-doodle-[a-z0-9-]*\.png$/);
  }
});

test('the type sniffer only recognises the three image formats a phone can save', () => {
  assert.equal(sniffImageType(png()), 'image/png');
  assert.equal(sniffImageType(jpeg()), 'image/jpeg');
  assert.equal(sniffImageType(webp()), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImageType(Buffer.from('<!doctype html><html></html>')), null);
  assert.equal(sniffImageType(Buffer.alloc(4)), null);
  assert.equal(sniffImageType('not a buffer'), null);
});
