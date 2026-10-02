import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageServer } from './index.mjs';

/** A minimal but real PNG header, which is all validateInput inspects. */
export function pngReference(width = 100, height = 100) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

export const ORIGIN = 'http://127.0.0.1:5173';
export const REFERENCE = pngReference();
export const INPUT = { category: { id: 'cat', name: 'Cat' }, idea: 'in a hat', references: [REFERENCE] };

/**
 * A scrypt hash of 'teacher-password-123' at the module's own parameters.
 * Test-only: it is in a test file, it guards nothing, and hashing it on every
 * run would add a second to the suite.
 */
export const TEST_PASSWORD = 'teacher-password-123';
export const TEST_EMAIL = 'teacher@fontys.nl';

export async function harness({ env = {}, fetcher, password = TEST_PASSWORD } = {}) {
  const { hashPassword } = await import('./admin.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'workshop-codes-'));
  const storeFile = join(directory, 'codes.json');
  const server = createImageServer({
    env: {
      APP_ORIGIN: ORIGIN,
      WORKSHOP_STORE_PATH: storeFile,
      ADMIN_USERS_JSON: JSON.stringify([{ email: TEST_EMAIL, passwordHash: await hashPassword(password) }]),
      PORTKEY_API_KEY: 'test-only',
      PORTKEY_VIRTUAL_KEY: 'test-route',
      IMAGE_MODEL: 'test-model',
      ...env,
    },
    fetcher: fetcher ?? (async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'YQ==' }] }) })),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = {
    base,
    server,
    storeFile,
    generate: (code, body = INPUT, init = {}) => fetch(`${base}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Workshop-Code': code } : {}), ...init.headers },
      body: JSON.stringify(body),
      signal: init.signal,
    }),
    admin: (path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) => fetch(`${base}/api/admin${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    async signIn(email = TEST_EMAIL, secret = password) {
      const response = await api.admin('/login', { method: 'POST', body: { email, password: secret } });
      const [raw] = response.headers.getSetCookie();
      return { response, cookie: raw?.split(';')[0] ?? '' };
    },
    /** Stops the server but keeps the store file, as a restart would. */
    async stop() { await new Promise((resolve) => server.close(resolve)); },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
  return api;
}
