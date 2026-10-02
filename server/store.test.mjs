import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError, storePath } from './store.mjs';
import { createCodeEntry } from './codes.mjs';

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), 'store-test-'));
  return { file: join(directory, 'codes.json'), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

const sample = (overrides = {}) => ({
  ...createCodeEntry({ label: 'Group A', expiresAt: null, usageLimit: 30, createdBy: 'teacher@example.com' }).entry,
  ...overrides,
});

test('a missing store initialises empty instead of failing', async () => {
  const { file, cleanup } = await scratch();
  try {
    const store = createStore(file);
    assert.deepEqual(await store.read(), []);
    // Nothing is written until there is something to write.
    await assert.rejects(readFile(file, 'utf8'), /ENOENT/);
  } finally { await cleanup(); }
});

test('codes and usage counters survive a store reload, which is what a restart does', async () => {
  const { file, cleanup } = await scratch();
  try {
    const store = createStore(file);
    await store.mutate((codes) => { codes.push(sample({ label: 'Group A' })); return { result: undefined }; });
    await store.mutate((codes) => { codes[0].usageCount = 7; return { result: undefined }; });

    // A brand-new store object over the same file is exactly what the next
    // process start sees.
    const restarted = createStore(file);
    const codes = await restarted.read();
    assert.equal(codes.length, 1);
    assert.equal(codes[0].label, 'Group A');
    assert.equal(codes[0].usageCount, 7);
  } finally { await cleanup(); }
});

test('reload() re-reads the file rather than trusting the cached copy', async () => {
  const { file, cleanup } = await scratch();
  try {
    const store = createStore(file);
    await store.mutate((codes) => { codes.push(sample()); return { result: undefined }; });
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.codes[0].usageCount = 12;
    await writeFile(file, JSON.stringify(data));
    assert.equal((await store.read())[0].usageCount, 0, 'the cached copy is used until reload');
    await store.reload();
    assert.equal((await store.read())[0].usageCount, 12);
  } finally { await cleanup(); }
});

test('read() hands out copies, so a caller cannot mutate the store behind its back', async () => {
  const { file, cleanup } = await scratch();
  try {
    const store = createStore(file);
    await store.mutate((codes) => { codes.push(sample()); return { result: undefined }; });
    const codes = await store.read();
    codes[0].usageCount = 999;
    assert.equal((await store.read())[0].usageCount, 0);
  } finally { await cleanup(); }
});

test('a malformed store fails closed and is never overwritten', async () => {
  for (const content of [
    'not json at all',
    '{}',
    '{"version":1}',
    '{"version":2,"codes":[]}',
    '{"version":1,"codes":{}}',
    '{"version":1,"codes":[{"id":"short"}]}',
    JSON.stringify({ version: 1, codes: [sample({ usageCount: -1 })] }),
    JSON.stringify({ version: 1, codes: [sample({ codeHash: 'not base64!!' })] }),
    JSON.stringify({ version: 1, codes: [sample({ id: 'aaaaaaaa' }), sample({ id: 'aaaaaaaa' })] }),
  ]) {
    const { file, cleanup } = await scratch();
    try {
      await writeFile(file, content);
      const store = createStore(file);
      await assert.rejects(store.read(), StoreError, `should reject: ${content.slice(0, 40)}`);
      // Failing closed must not mean "start fresh and lose every code".
      assert.equal(await readFile(file, 'utf8'), content);
      // A rejection must not wedge the serialisation chain for later calls.
      await assert.rejects(store.read(), StoreError);
    } finally { await cleanup(); }
  }
});

test('writes are serialised, so concurrent increments cannot be lost', async () => {
  const { file, cleanup } = await scratch();
  try {
    const store = createStore(file);
    await store.mutate((codes) => { codes.push(sample()); return { result: undefined }; });
    await Promise.all(Array.from({ length: 25 }, () => store.mutate((codes) => {
      codes[0].usageCount += 1;
      return { result: undefined };
    })));
    assert.equal((await createStore(file).read())[0].usageCount, 25);
  } finally { await cleanup(); }
});

test('the store writes atomically and leaves no temporary files behind', async () => {
  const { file, cleanup } = await scratch();
  try {
    const store = createStore(file);
    await store.mutate((codes) => { codes.push(sample()); return { result: undefined }; });
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(join(file, '..'));
    assert.deepEqual(entries, ['codes.json']);
  } finally { await cleanup(); }
});

test('the default store path is server-side and outside any published asset folder', () => {
  const path = storePath({});
  assert.match(path, /server\/\.data\/workshop-codes\.json$/);
  assert.doesNotMatch(path, /(^|\/)(public|dist)\//);
  // The path comes from the environment only; no request value reaches it.
  assert.equal(storePath({ WORKSHOP_STORE_PATH: '/tmp/x/codes.json' }), '/tmp/x/codes.json');
});
