/**
 * Bounded concurrency with a FIFO waiting room.
 *
 * A class of fifteen children presses "Create my picture" in the same minute.
 * Fifteen simultaneous provider calls is both slow and expensive, and one at a
 * time means the last child waits for fourteen generations. So: a few run,
 * the rest queue, and the queue itself is bounded so an overloaded workshop
 * fails fast and friendly instead of piling up connections.
 *
 * FIFO matters: it is what stops the child who clicked first from being
 * starved by later arrivals.
 */
export class BusyError extends Error {
  constructor() { super('The picture queue is full.'); this.code = 'busy'; }
}
export class QueueTimeoutError extends Error {
  constructor() { super('Waited too long for a free picture slot.'); this.code = 'queue-timeout'; }
}
export class AcquireAbortedError extends Error {
  constructor() { super('The request went away before its turn.'); this.code = 'aborted'; }
}

export function createLimiter({ concurrency = 4, queueLimit = 20, waitMs = 120_000 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  if (!Number.isInteger(queueLimit) || queueLimit < 0) throw new Error('queueLimit must be a non-negative integer');
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('waitMs must be a non-negative number');

  let active = 0;
  const waiting = [];

  const detach = (waiter) => {
    if (waiter.settled) return false;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
    const index = waiting.indexOf(waiter);
    if (index !== -1) waiting.splice(index, 1);
    return true;
  };

  const lease = () => {
    active += 1;
    let released = false;
    // Idempotent on purpose: the request path releases in `finally`, and a
    // double release would hand out a slot that is still in use.
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      pump();
    };
  };

  function pump() {
    while (active < concurrency && waiting.length > 0) {
      const waiter = waiting[0];
      if (!detach(waiter)) { waiting.shift(); continue; }
      waiter.resolve(lease());
    }
  }

  return {
    get active() { return active; },
    get queued() { return waiting.length; },
    /** Resolves to a `release()` function. Throws Busy/Timeout/Aborted. */
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(new AcquireAbortedError());
      if (active < concurrency) return Promise.resolve(lease());
      if (waiting.length >= queueLimit) return Promise.reject(new BusyError());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, settled: false };
        waiter.onAbort = () => { if (detach(waiter)) reject(new AcquireAbortedError()); };
        waiter.timer = setTimeout(() => { if (detach(waiter)) reject(new QueueTimeoutError()); }, waitMs);
        waiter.timer.unref?.();
        signal?.addEventListener('abort', waiter.onAbort, { once: true });
        waiting.push(waiter);
      });
    },
  };
}

/**
 * A sliding-window counter per key, used as an abuse ceiling per workshop
 * code. The window is deliberately generous: a whole class creating pictures
 * in parallel is the normal case, not the attack.
 */
export function createRateLimiter({ limit = 30, windowMs = 60_000, maxKeys = 500 } = {}) {
  const hits = new Map();
  const prune = (now) => {
    for (const [key, times] of hits) {
      const kept = times.filter((time) => time > now - windowMs);
      if (kept.length === 0) hits.delete(key); else hits.set(key, kept);
    }
  };
  return {
    /** True when the key has budget left. Records the hit. */
    take(key, now = Date.now()) {
      if (limit <= 0) return true;
      const times = (hits.get(key) ?? []).filter((time) => time > now - windowMs);
      if (times.length >= limit) { hits.set(key, times); return false; }
      times.push(now);
      hits.set(key, times);
      if (hits.size > maxKeys) prune(now);
      return true;
    },
  };
}
