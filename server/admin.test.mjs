import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearedCookie, createAdminAuth, hashPassword, MIN_PASSWORD_LENGTH, parseAdmins, parseCookies,
  SESSION_COOKIE, sessionCookie, verifyPassword,
} from './admin.mjs';

const PASSWORD = 'workshop-teacher-pass';
// Cheap scrypt parameters: these tests exercise the logic, not the work factor.
const FAST = { N: 1_024, r: 8, p: 1, keylen: 32 };

test('passwords are stored as salted scrypt hashes, never as plaintext', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  assert.match(hash, /^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!hash.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword(`${PASSWORD} `, hash), false);
  assert.equal(await verifyPassword('', hash), false);

  // A fresh salt per hash, so two teachers with the same password do not
  // share a hash and a rainbow table is useless.
  assert.notEqual(hash, await hashPassword(PASSWORD, FAST));
  await assert.rejects(hashPassword('short', FAST), new RegExp(`${MIN_PASSWORD_LENGTH} characters`));
});

test('a damaged or forged hash never verifies', async () => {
  for (const broken of [
    '', 'plaintext', 'scrypt$1024$8$1$onlyfourparts',
    'bcrypt$1024$8$1$AAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA',
    'scrypt$0$8$1$AAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA',
    'scrypt$1024$8$1$AA$AAAAAAAAAAAAAAAAAAAAAAAA',
    'scrypt$99999999$8$1$AAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA',
  ]) {
    assert.equal(await verifyPassword(PASSWORD, broken), false, `must not accept ${broken}`);
  }
});

test('the admin allowlist fails closed on anything malformed', async () => {
  const passwordHash = await hashPassword(PASSWORD, FAST);
  assert.equal(parseAdmins('').size, 0);
  assert.equal(parseAdmins('   ').size, 0);
  const admins = parseAdmins(JSON.stringify([{ email: '  Teacher@Fontys.NL ', passwordHash }]));
  assert.deepEqual([...admins.keys()], ['teacher@fontys.nl'], 'emails are normalised, so case cannot lock a teacher out');

  for (const bad of [
    'not json', '{}', '[]',
    JSON.stringify([{ email: 'no-hash@example.com' }]),
    JSON.stringify([{ email: 'bad@example.com', passwordHash: 'plaintext-password' }]),
    JSON.stringify([{ email: 'notanemail', passwordHash }]),
    JSON.stringify([{ passwordHash }]),
    JSON.stringify(Array.from({ length: 21 }, () => ({ email: 'a@b.c', passwordHash }))),
  ]) {
    assert.throws(() => parseAdmins(bad), Error, `must refuse ${bad.slice(0, 40)}`);
  }
});

async function auth(overrides = {}) {
  const admins = parseAdmins(JSON.stringify([
    { email: 'teacher@fontys.nl', passwordHash: await hashPassword(PASSWORD, FAST) },
  ]));
  return createAdminAuth({ admins, maxFailures: 3, lockoutMs: 60_000, ...overrides });
}

test('a correct sign-in issues a random session token', async () => {
  const guard = await auth();
  assert.equal(guard.configured(), true);
  const first = await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.1');
  const second = await guard.login('TEACHER@fontys.nl', PASSWORD, '10.0.0.1');
  assert.equal(first.ok, true);
  assert.notEqual(first.token, second.token, 'tokens must not repeat');
  assert.ok(first.token.length >= 32, 'at least 256 bits of base64url');
  assert.deepEqual(guard.verify(first.token), { email: 'teacher@fontys.nl' });
  assert.deepEqual(guard.verify(second.token), { email: 'teacher@fontys.nl' });
});

test('a wrong password and an unknown email are indistinguishable', async () => {
  const guard = await auth();
  assert.deepEqual(await guard.login('teacher@fontys.nl', 'wrong-password', '10.0.0.1'), { ok: false, locked: false });
  assert.deepEqual(await guard.login('stranger@example.com', PASSWORD, '10.0.0.2'), { ok: false, locked: false });
  assert.deepEqual(await guard.login('', '', '10.0.0.3'), { ok: false, locked: false });
  // Both paths run a real scrypt, so the result carries no timing hint about
  // whether the email exists.
  assert.equal(guard.sessionCount, 0);
});

test('repeated failures lock the attempt out, and a success clears the counter', async () => {
  const guard = await auth();
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await guard.login('teacher@fontys.nl', 'wrong', '10.0.0.9'), { ok: false, locked: false });
  }
  // Locked even though the password is now right: that is the point.
  assert.deepEqual(await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.9'), { ok: false, locked: true });
  // A different address is locked too, because the email counter tripped.
  assert.deepEqual(await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.10'), { ok: false, locked: true });
  // An unrelated email from an unrelated address still works.
  assert.equal((await guard.login('stranger@example.com', 'x', '10.0.0.11')).locked, false);

  let clock = 0;
  const windowed = await auth({ now: () => clock, maxFailures: 2, lockoutMs: 1_000 });
  for (let attempt = 0; attempt < 2; attempt++) await windowed.login('teacher@fontys.nl', 'wrong', '10.0.0.12');
  assert.equal((await windowed.login('teacher@fontys.nl', PASSWORD, '10.0.0.12')).locked, true);
  clock = 2_000;
  const after = await windowed.login('teacher@fontys.nl', PASSWORD, '10.0.0.12');
  assert.equal(after.ok, true, 'the lockout expires rather than stranding the teacher');
  for (let attempt = 0; attempt < 1; attempt++) await windowed.login('teacher@fontys.nl', 'wrong', '10.0.0.12');
  assert.equal((await windowed.login('teacher@fontys.nl', PASSWORD, '10.0.0.12')).ok, true, 'a success resets the counter');
});

test('sessions expire, can be logged out, and never resurrect', async () => {
  let clock = 1_000;
  const guard = await auth({ now: () => clock, ttlMs: 5_000 });
  const { token } = await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.1');
  assert.ok(guard.verify(token));
  clock = 5_999;
  assert.ok(guard.verify(token));
  clock = 6_000;
  assert.equal(guard.verify(token), null, 'expired exactly at the deadline');

  clock = 10_000;
  const second = await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.1');
  assert.equal(guard.logout(second.token), true);
  assert.equal(guard.verify(second.token), null);
  assert.equal(guard.logout(second.token), false, 'logging out twice is harmless');
});

test('a forged or absent token is refused without touching the session map', async () => {
  const guard = await auth();
  const { token } = await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.1');
  for (const forged of [undefined, null, '', 'short', 'x'.repeat(200), `${token}x`, token.slice(0, -1), 42, {}]) {
    assert.equal(guard.verify(forged), null, `must refuse ${JSON.stringify(forged)}`);
  }
  assert.ok(guard.verify(token), 'the real token still works');
});

test('the session map is bounded, so a login loop cannot exhaust memory', async () => {
  let clock = 0;
  const guard = await auth({ now: () => { clock += 1; return clock; }, maxSessions: 5 });
  for (let attempt = 0; attempt < 20; attempt++) await guard.login('teacher@fontys.nl', PASSWORD, '10.0.0.1');
  assert.ok(guard.sessionCount <= 5);
});

test('an unconfigured server reports that the panel is unavailable', () => {
  const guard = createAdminAuth();
  assert.equal(guard.configured(), false);
});

test('the session cookie cannot be read by script and does not travel cross-site', () => {
  const cookie = sessionCookie('token-value', { secure: true, ttlMs: 28_800_000 });
  assert.match(cookie, /^workshop_admin=token-value;/);
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Strict'));
  assert.ok(cookie.includes('Secure'));
  assert.ok(cookie.includes('Max-Age=28800'));
  assert.ok(!sessionCookie('t', { secure: false, ttlMs: 1_000 }).includes('Secure'), 'local http development still works');
  assert.ok(clearedCookie({ secure: true }).includes('Max-Age=0'));
  assert.ok(clearedCookie({ secure: true }).includes('HttpOnly'));
});

test('cookie parsing survives the junk a real browser sends', () => {
  const jar = parseCookies(`other=1; ${SESSION_COOKIE}=abc; broken; =nothing; other=2`);
  assert.equal(jar.get(SESSION_COOKIE), 'abc');
  assert.equal(jar.get('other'), '1', 'the first value wins, so a second cannot shadow it');
  assert.equal(parseCookies(undefined).size, 0);
  assert.equal(parseCookies('').size, 0);
});
