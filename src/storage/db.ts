import type { ChallengeStats, ClassId, Example } from '../types';

/**
 * Tiny IndexedDB wrapper. Everything stays on this device -- there is no
 * server and nothing is ever uploaded. If IndexedDB is unavailable the app
 * still works, it simply forgets its examples when the tab closes.
 */

const DB_NAME = 'ai-doodle-lab';
const DB_VERSION = 1;
const EXAMPLES = 'examples';
const META = 'meta';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EXAMPLES)) {
        db.createObjectStore(EXAMPLES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
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

export const loadClassNames = () => readMeta<Record<ClassId, string>>('classNames');
export const saveClassNames = (names: Record<ClassId, string>) => writeMeta('classNames', names);

export const loadStats = () => readMeta<ChallengeStats>('challengeStats');
export const saveStats = (stats: ChallengeStats) => writeMeta('challengeStats', stats);

export async function clearMeta(): Promise<void> {
  await run(META, 'readwrite', (store) => store.clear());
}
