import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BusyError, createLimiter, createRateLimiter, QueueTimeoutError,
} from './queue.mjs';

const settled = (promise) => promise.then(() => 'resolved', (error) => error.code ?? 'rejected');

test('four requests run at once and the fifth waits for a free slot', async () => {
  const limiter = createLimiter({ concurrency: 4, queueLimit: 20, waitMs: 5_000 });
  const releases = await Promise.all(Array.from({ length: 4 }, () => limiter.acquire()));
  assert.equal(limiter.active, 4);
  assert.equal(limiter.queued, 0);

  const fifth = limiter.acquire();
  await delay(5);
  assert.equal(limiter.queued, 1, 'the fifth is waiting, not running');
  assert.equal(limiter.active, 4);

  // Releasing a slot must hand it straight to the waiting request.
  releases[0]();
  const release = await fifth;
  assert.equal(limiter.active, 4);
  assert.equal(limiter.queued, 0);
  release();
  for (const done of releases.slice(1)) done();
  assert.equal(limiter.active, 0);
});

test('the queue is bounded and reports busy rather than piling up', async () => {
  const limiter = createLimiter({ concurrency: 1, queueLimit: 2, waitMs: 5_000 });
  const first = await limiter.acquire();
  const waiting = [limiter.acquire(), limiter.acquire()];
  assert.equal(limiter.queued, 2);
  await assert.rejects(limiter.acquire(), BusyError);

  // Freeing a slot promotes the head of the queue and makes room again, so
  // busy is back-pressure rather than a permanent state.
  first();
  assert.equal(limiter.queued, 1);
  assert.equal(limiter.active, 1);
  const extra = limiter.acquire();
  assert.equal(limiter.queued, 2);
  await assert.rejects(limiter.acquire(), BusyError);

  (await waiting[0])();
  (await waiting[1])();
  (await extra)();
  assert.equal(limiter.active, 0);
  assert.equal(limiter.queued, 0);
});

test('a queued request that waits too long gives up and frees its place', async () => {
  const limiter = createLimiter({ concurrency: 1, queueLimit: 1, waitMs: 20 });
  const release = await limiter.acquire();
  await assert.rejects(limiter.acquire(), QueueTimeoutError);
  assert.equal(limiter.queued, 0, 'the timed-out waiter is gone from the queue');
  release();
  assert.equal(limiter.active, 0, 'and it never took a slot');
});

test('an aborted queued request disappears cleanly and leaves no dead slot', async () => {
  const limiter = createLimiter({ concurrency: 1, queueLimit: 5, waitMs: 5_000 });
  const release = await limiter.acquire();
  const controller = new AbortController();
  const queued = limiter.acquire(controller.signal);
  const behind = limiter.acquire();
  assert.equal(limiter.queued, 2);

  controller.abort();
  assert.equal(await settled(queued), 'aborted');
  assert.equal(limiter.queued, 1);

  release();
  const next = await behind;
  assert.equal(limiter.active, 1, 'the slot went to the request still waiting');
  next();
  assert.equal(limiter.active, 0);

  // A signal already aborted is refused without ever taking a slot.
  assert.equal(await settled(limiter.acquire(AbortSignal.abort())), 'aborted');
  assert.equal(limiter.active, 0);
});

test('releasing twice cannot hand out a slot that is still in use', async () => {
  const limiter = createLimiter({ concurrency: 2, queueLimit: 1, waitMs: 1_000 });
  const release = await limiter.acquire();
  await limiter.acquire();
  release();
  release();
  release();
  assert.equal(limiter.active, 1, 'the second and third release are ignored');
});

test('slots survive an error inside the work they guard', async () => {
  const limiter = createLimiter({ concurrency: 1, queueLimit: 5, waitMs: 1_000 });
  for (let attempt = 0; attempt < 10; attempt++) {
    const release = await limiter.acquire();
    try { throw new Error('provider exploded'); }
    catch { /* the caller's finally is what matters */ }
    finally { release(); }
  }
  assert.equal(limiter.active, 0, 'ten failures leaked nothing');
  assert.ok(await limiter.acquire());
});

test('waiting requests are served first in, first out, so nobody starves', async () => {
  const limiter = createLimiter({ concurrency: 1, queueLimit: 10, waitMs: 5_000 });
  const order = [];
  let release = await limiter.acquire();
  const waiters = Array.from({ length: 5 }, (_, index) =>
    limiter.acquire().then((done) => { order.push(index); return done; }));
  for (let step = 0; step < 5; step++) {
    release();
    release = await waiters[step];
  }
  release();
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
});

test('a zero-length queue means no waiting room at all', async () => {
  const limiter = createLimiter({ concurrency: 1, queueLimit: 0, waitMs: 1_000 });
  const release = await limiter.acquire();
  await assert.rejects(limiter.acquire(), BusyError);
  release();
  assert.ok(await limiter.acquire());
});

test('the limiter refuses nonsense configuration at boot', () => {
  for (const options of [
    { concurrency: 0 }, { concurrency: -1 }, { concurrency: 1.5 },
    { queueLimit: -1 }, { queueLimit: 2.5 }, { waitMs: -1 }, { waitMs: Number.NaN },
  ]) {
    assert.throws(() => createLimiter(options), Error, `must refuse ${JSON.stringify(options)}`);
  }
});

test('the per-code rate limiter is generous to a class and firm with a script', () => {
  const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
  // Fifteen students, two pictures each in the same minute: all allowed.
  for (let student = 0; student < 15; student++) {
    assert.equal(limiter.take('group-a', 1_000), true);
    assert.equal(limiter.take('group-a', 1_000), true);
  }
  assert.equal(limiter.take('group-a', 1_000), false, 'the 31st in one minute is refused');
  // Another class is unaffected: one group cannot punish another.
  assert.equal(limiter.take('group-b', 1_000), true);
  // And the window slides rather than resetting on a fixed boundary.
  assert.equal(limiter.take('group-a', 61_001), true);
  assert.equal(createRateLimiter({ limit: 0 }).take('anything'), true, 'zero disables the ceiling');
});

test('the rate limiter prunes its keys instead of growing forever', () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 1_000, maxKeys: 10 });
  for (let key = 0; key < 50; key++) limiter.take(`code-${key}`, 1_000);
  // Everything is stale by now, so the next call must clear the old keys and
  // still answer correctly.
  assert.equal(limiter.take('code-0', 100_000), true);
  for (let attempt = 0; attempt < 4; attempt++) assert.equal(limiter.take('code-0', 100_000), true);
  assert.equal(limiter.take('code-0', 100_000), false);
});
