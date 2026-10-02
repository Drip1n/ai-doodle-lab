import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * The workshop-code store: a single JSON file written atomically.
 *
 * Why a file and not a database: the workshop runs one Node process next to a
 * static site. Codes and their usage counters have to survive `systemctl
 * restart`, and nothing more. A file plus `rename()` gives that without any
 * infrastructure to stand up on the morning of the workshop.
 *
 * A malformed file is a hard failure, never an empty store. Starting fresh
 * would silently hand every class a dead code and quietly reset usage
 * counters, so the server refuses to serve code-dependent routes instead.
 */
export class StoreError extends Error {}

const SHAPE = 1;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function storePath(env = process.env) {
  return resolve(env.WORKSHOP_STORE_PATH || 'server/.data/workshop-codes.json');
}

function validEntry(value) {
  const time = (candidate) => candidate === null || (Number.isFinite(candidate) && candidate >= 0);
  return Boolean(value) && typeof value === 'object'
    && typeof value.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value.id)
    && typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 60
    && typeof value.codeHash === 'string' && value.codeHash.length <= 100 && BASE64.test(value.codeHash)
    && typeof value.salt === 'string' && value.salt.length <= 100 && BASE64.test(value.salt)
    && typeof value.prefix === 'string' && value.prefix.length > 0 && value.prefix.length <= 40
    && Number.isFinite(value.createdAt) && value.createdAt >= 0
    && time(value.expiresAt) && time(value.revokedAt)
    && Number.isInteger(value.usageCount) && value.usageCount >= 0
    && Number.isInteger(value.usageLimit) && value.usageLimit >= 1 && value.usageLimit <= 100_000
    && typeof value.createdBy === 'string' && value.createdBy.length <= 160;
}

function parse(text, path) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new StoreError(`${path} is not valid JSON`); }
  if (!raw || typeof raw !== 'object' || raw.version !== SHAPE || !Array.isArray(raw.codes)) {
    throw new StoreError(`${path} does not hold a workshop-code store`);
  }
  if (raw.codes.length > 500) throw new StoreError(`${path} holds an implausible number of codes`);
  const bad = raw.codes.findIndex((entry) => !validEntry(entry));
  if (bad !== -1) throw new StoreError(`${path} has a malformed code entry at index ${bad}`);
  const ids = new Set(raw.codes.map((entry) => entry.id));
  if (ids.size !== raw.codes.length) throw new StoreError(`${path} has duplicate code ids`);
  return { version: SHAPE, codes: raw.codes };
}

/**
 * All reads and writes go through one promise chain, so a read-modify-write
 * from one request can never interleave with another's. That serialisation is
 * what makes the usage counters safe while four generations run at once.
 */
export function createStore(path = storePath()) {
  let cached = null;
  let chain = Promise.resolve();

  const load = async () => {
    if (cached) return cached;
    let text;
    try { text = await readFile(path, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') { cached = { version: SHAPE, codes: [] }; return cached; }
      throw new StoreError(`${path} could not be read: ${error.code ?? 'unknown error'}`);
    }
    cached = parse(text, path);
    return cached;
  };

  const persist = async (data) => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw new StoreError(`${path} could not be written: ${error.code ?? 'unknown error'}`);
    }
  };

  /** Runs `work` with exclusive access. `work` returns `{ result, write }`. */
  const run = (work, { withData = true } = {}) => {
    const task = chain.then(async () => {
      const data = withData ? await load() : null;
      const { result, write = false } = await work(data);
      if (write) await persist(data);
      return result;
    });
    // Keep the chain alive after a rejection so one bad write cannot wedge
    // every later request.
    chain = task.then(() => undefined, () => undefined);
    return task;
  };

  return {
    path,
    /** A frozen view for read-only callers. */
    read: () => run((data) => ({ result: data.codes.map((entry) => ({ ...entry })) })),
    mutate: (fn) => run(async (data) => {
      const outcome = await fn(data.codes);
      return { result: outcome?.result, write: outcome?.write !== false };
    }),
    /** Drops the in-memory copy, so the next call re-reads the file. */
    reload: () => run(() => { cached = null; return { result: undefined }; }, { withData: false }),
  };
}
