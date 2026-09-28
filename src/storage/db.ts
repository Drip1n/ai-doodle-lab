import type { AiDrawStats, ChallengeStats, Example, LearningClass } from '../types';

/**
 * Tiny IndexedDB wrapper. Everything stays on this device -- there is no
 * server and nothing is ever uploaded. If IndexedDB is unavailable the app
 * still works, it simply forgets its examples when the tab closes.
 */

const DB_NAME = 'ai-doodle-lab';
const DB_VERSION = 1;
const EXAMPLES = 'examples';
const META = 'meta';

/**
 * Opening can hang indefinitely -- another tab holding an old version open, a
 * delete still pending -- without ever firing success, error or blocked. The
 * app must never wait forever for storage, so give up and carry on in memory.
 */
const OPEN_TIMEOUT_MS = 4000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };

    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    const done = (db: IDBDatabase | null) => {
      clearTimeout(timer);
      finish(db);
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EXAMPLES)) {
        db.createObjectStore(EXAMPLES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => done(request.result);
    request.onerror = () => done(null);
    request.onblocked = () => done(null);
  });
  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(storeName, mode);
          const request = action(tx.objectStore(storeName));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/**
 * Whether this browser actually gave us a database. False in private windows
 * with storage blocked, or when the open request timed out -- the app keeps
 * working, but nothing survives a reload, and the UI says so.
 */
export async function isAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

export async function loadExamples(): Promise<Example[]> {
  const rows = await run<Example[]>(EXAMPLES, 'readonly', (store) => store.getAll());
  if (!rows) return [];
  return rows
    .filter((row) => row && row.embedding && row.thumbnail)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveExample(example: Example): Promise<void> {
  await run(EXAMPLES, 'readwrite', (store) => store.put(example));
}

export async function deleteExample(id: string): Promise<void> {
  await run(EXAMPLES, 'readwrite', (store) => store.delete(id));
}

export async function deleteExamplesForClass(classId: string): Promise<void> {
  const rows = await loadExamples();
  await Promise.all(
    rows.filter((row) => row.classId === classId).map((row) => deleteExample(row.id)),
  );
}

export async function clearExamples(): Promise<void> {
  await run(EXAMPLES, 'readwrite', (store) => store.clear());
}

async function readMeta<T>(key: string): Promise<T | null> {
  const row = await run<{ key: string; value: T }>(META, 'readonly', (store) => store.get(key));
  return row ? row.value : null;
}

async function writeMeta<T>(key: string, value: T): Promise<void> {
  await run(META, 'readwrite', (store) => store.put({ key, value }));
}

export const loadClasses = () => readMeta<LearningClass[]>('classes');
export const saveClasses = (classes: LearningClass[]) => writeMeta('classes', classes);

export const loadStats = () => readMeta<ChallengeStats>('challengeStats');
export const saveStats = (stats: ChallengeStats) => writeMeta('challengeStats', stats);

export const loadMemoryStats = () => readMeta<ChallengeStats>('memoryStats');
export const saveMemoryStats = (stats: ChallengeStats) => writeMeta('memoryStats', stats);

export const loadAiDrawStats = () => readMeta<AiDrawStats>('aiDrawStats');
export const saveAiDrawStats = (stats: AiDrawStats) => writeMeta('aiDrawStats', stats);

export async function clearMeta(): Promise<void> {
  await run(META, 'readwrite', (store) => store.clear());
}
