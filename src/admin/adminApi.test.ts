import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('admin API client', () => {
  it('derives its base from the image endpoint, so one server needs one setting', async () => {
    for (const [endpoint, expected] of [
      ['/api/generate-image', '/api'],
      ['/api/generate-image/', '/api'],
      ['https://lab.example/api/generate-image', 'https://lab.example/api'],
      ['', '/api'],
    ] as const) {
      vi.resetModules();
      vi.stubEnv('VITE_IMAGE_ENDPOINT', endpoint);
      vi.stubEnv('VITE_ADMIN_ENDPOINT', '');
      const { ADMIN_BASE } = await import('./adminApi');
      expect(ADMIN_BASE, `endpoint ${endpoint}`).toBe(expected);
    }
    vi.resetModules();
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    vi.stubEnv('VITE_ADMIN_ENDPOINT', 'https://admin.example/api/');
    expect((await import('./adminApi')).ADMIN_BASE).toBe('https://admin.example/api');
  });

  it('sends the session cookie and never a credential of its own', async () => {
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ email: 'a@b.c', codes: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('./adminApi');

    await api.listCodes();
    await api.adminLogin('teacher@fontys.nl', 'secret-password');
    await api.adminLogout();
    await api.createCode({ label: 'Group A', expiresInHours: 8, usageLimit: 30 });
    await api.revokeCode('id-a');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/codes', '/api/admin/login', '/api/admin/logout', '/api/admin/codes', '/api/admin/codes/id-a/revoke',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.credentials).toBe('include');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers.Authorization).toBeUndefined();
    }
    // The password goes in one request body and is kept nowhere else.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('escapes the code id, so a crafted id cannot reshape the URL', async () => {
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { revokeCode } = await import('./adminApi');
    await revokeCode('../../etc/passwd');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/codes/..%2F..%2Fetc%2Fpasswd/revoke');
  });

  it('turns each failure into one wording the panel owns', async () => {
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const { AdminError, isSignedOut, listCodes } = await import('./adminApi');
    for (const [status, expected] of [
      [401, 'Sign-in failed. Check the email and password.'],
      [403, 'This browser is not allowed to manage workshop codes.'],
      [429, 'Too many sign-in attempts. Wait a few minutes and try again.'],
      [503, 'Admin access is not configured on this server.'],
      [500, 'That did not work. Please try again.'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: 'internal detail' }) }));
      await expect(listCodes()).rejects.toThrow(expected);
    }
    // A network failure is not a sign-in failure, and must not be shown as one.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listCodes()).rejects.toThrow('Could not reach the workshop server.');
    expect(isSignedOut(new AdminError('x', 401))).toBe(true);
    expect(isSignedOut(new AdminError('x', 403))).toBe(false);
    expect(isSignedOut(new Error('x'))).toBe(false);
  });
});
