import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkCode, claimCode, codePrefix, codeState, createCodeEntry, findCode, maskedCode,
  normaliseCode, publicCode, randomCodeBody,
} from './codes.mjs';
import { createStore } from './store.mjs';

const make = (overrides = {}) => createCodeEntry({
  label: 'Group A', expiresAt: null, usageLimit: 30, createdBy: 'teacher@example.com', prefix: 'FONTYS', ...overrides,
});

async function scratchStore() {
  const directory = await mkdtemp(join(tmpdir(), 'codes-test-'));
  const file = join(directory, 'codes.json');
  return { store: createStore(file), file, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('generated codes are cryptographically random, not Math.random', () => {
  const bodies = new Set(Array.from({ length: 5_000 }, () => randomCodeBody()));
  assert.equal(bodies.size, 5_000, 'no collisions across 5000 draws');
  const body = randomCodeBody();
  assert.match(body, /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/, 'no look-alike characters a child could mistype');

  // Every alphabet character must be reachable: a biased or truncated sampler
  // would quietly shrink the keyspace.
  const seen = new Set([...Array.from({ length: 2_000 }, () => randomCodeBody()).join('')]);
  assert.equal(seen.size, 30);

  // And the distribution must be flat enough that no character is favoured.
  const counts = new Map();
  for (const character of Array.from({ length: 4_000 }, () => randomCodeBody()).join('')) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  const expected = (4_000 * 8) / 30;
  for (const [character, count] of counts) {
    assert.ok(Math.abs(count - expected) < expected * 0.3, `${character} appeared ${count} times, expected ~${expected}`);
  }
});

test('the full code exists only in the creation result, never in the stored entry', () => {
  const { code, entry } = make();
  assert.match(code, /^FONTYS-[A-Z2-9]{8}$/);
  const serialised = JSON.stringify(entry);
  assert.ok(!serialised.includes(code), 'the stored entry must not contain the plaintext');
  assert.ok(!serialised.includes(code.slice(-6)), 'nor the secret tail of it');
  assert.ok(!('code' in entry));
  assert.equal(maskedCode(entry), `${code.slice(0, 9)}•••`);
  assert.ok(!JSON.stringify(publicCode(entry)).includes(code), 'nor the admin-facing view');
});

test('prefixes come from configuration and fall back safely', () => {
  assert.equal(codePrefix({}), 'FONTYS');
  assert.equal(codePrefix({ WORKSHOP_CODE_PREFIX: 'school' }), 'SCHOOL');
  assert.equal(codePrefix({ WORKSHOP_CODE_PREFIX: 'bad prefix!' }), 'FONTYS');
  assert.equal(codePrefix({ WORKSHOP_CODE_PREFIX: 'A' }), 'FONTYS');
});

test('matching ignores case and padding but nothing else', () => {
  const { code, entry } = make();
  assert.equal(findCode([entry], code)?.id, entry.id);
  assert.equal(findCode([entry], `  ${code.toLowerCase()}  `)?.id, entry.id);
  for (const wrong of [`${code}X`, code.slice(0, -1), 'FONTYS-ZZZZZZZZ', '', null, undefined, 42, {}, code.replace('-', '')]) {
    assert.equal(findCode([entry], wrong), null, `must not match ${JSON.stringify(wrong)}`);
  }
  assert.equal(normaliseCode('a'.repeat(200)), '', 'an absurdly long code is refused outright');
  assert.equal(normaliseCode('with space'), '');
});

test('a code is only usable while it is active', () => {
  const now = 1_000_000;
  assert.equal(codeState(null, now), 'unknown');
  assert.equal(codeState(make({ expiresAt: null }).entry, now), 'active');
  assert.equal(codeState(make({ expiresAt: now + 1 }).entry, now), 'active');
  assert.equal(codeState(make({ expiresAt: now }).entry, now), 'expired');
  assert.equal(codeState(make({ expiresAt: now - 1 }).entry, now), 'expired');
  assert.equal(codeState({ ...make().entry, revokedAt: now - 1 }, now), 'revoked');
  assert.equal(codeState({ ...make({ usageLimit: 2 }).entry, usageCount: 2 }, now), 'exhausted');
  // Revocation wins over everything else, so a revoked code never comes back.
  assert.equal(codeState({ ...make({ expiresAt: now + 10_000 }).entry, revokedAt: now - 1 }, now), 'revoked');
});

test('claiming spends exactly one use and refuses every inactive state', async () => {
  const { store, file, cleanup } = await scratchStore();
  try {
    const active = make({ usageLimit: 2 });
    const revoked = make({ label: 'Revoked' });
    const expired = make({ label: 'Expired', expiresAt: 1 });
    revoked.entry.revokedAt = 5;
    await store.mutate((codes) => { codes.push(active.entry, revoked.entry, expired.entry); return { result: undefined }; });

    assert.deepEqual(await checkCode(store, active.code), { state: 'active', id: active.entry.id });
    assert.equal((await claimCode(store, active.code)).ok, true);
    assert.equal((await store.read()).find((entry) => entry.id === active.entry.id).usageCount, 1);

    // A check never spends anything.
    await checkCode(store, active.code);
    assert.equal((await store.read()).find((entry) => entry.id === active.entry.id).usageCount, 1);

    assert.equal((await claimCode(store, active.code)).ok, true);
    assert.deepEqual(await claimCode(store, active.code), { ok: false, state: 'exhausted' });
    assert.deepEqual(await claimCode(store, revoked.code), { ok: false, state: 'revoked' });
    assert.deepEqual(await claimCode(store, expired.code), { ok: false, state: 'expired' });
    assert.deepEqual(await claimCode(store, 'FONTYS-ZZZZZZZZ'), { ok: false, state: 'unknown' });

    // Nothing in the file is the plaintext of any code.
    const stored = await readFile(file, 'utf8');
    for (const { code } of [active, revoked, expired]) assert.ok(!stored.includes(code));
  } finally { await cleanup(); }
});

test('concurrent claims cannot push a code past its usage limit', async () => {
  const { store, cleanup } = await scratchStore();
  try {
    const { code, entry } = make({ usageLimit: 5 });
    await store.mutate((codes) => { codes.push(entry); return { result: undefined }; });
    const results = await Promise.all(Array.from({ length: 20 }, () => claimCode(store, code)));
    assert.equal(results.filter((result) => result.ok).length, 5);
    assert.equal((await store.read())[0].usageCount, 5);
    assert.ok(results.filter((result) => !result.ok).every((result) => result.state === 'exhausted'));
  } finally { await cleanup(); }
});

test('the admin view exposes operational metadata and nothing else', () => {
  const { entry } = make({ expiresAt: 2_000 });
  const view = publicCode(entry, 1_000);
  assert.deepEqual(Object.keys(view).sort(), [
    'createdAt', 'createdBy', 'expiresAt', 'id', 'label', 'masked', 'revokedAt', 'state', 'usageCount', 'usageLimit',
  ]);
  assert.ok(!('codeHash' in view) && !('salt' in view), 'no hash material leaves the server');
  assert.equal(view.expiresAt, new Date(2_000).toISOString());
});
