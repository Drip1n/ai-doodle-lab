import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('image connection', () => {
  it('defaults to demo and rejects an unconfigured connection without fetching', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', '');
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const api = await import('./imageApi');
    expect(api.IMAGE_MODE).toBe('demo');
    await expect(api.requestImage({ category: { id: 'cat', name: 'Cat' }, idea: 'in a hat', references: [] }, new AbortController().signal)).rejects.toThrow('not connected');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only the subject, idea and references to the server and reads an image', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live'); vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ image: 'data:image/png;base64,YQ==' }) });
    vi.stubGlobal('fetch', fetch);
    const api = await import('./imageApi');
    const request = { category: { id: 'cat', name: 'Cat' }, idea: 'in a hat', references: ['data:image/png;base64,YQ=='] };
    const signal = new AbortController().signal;
    expect(await api.requestImage(request, signal)).toBe('data:image/png;base64,YQ==');
    expect(fetch).toHaveBeenCalledWith('/api/generate-image', expect.objectContaining({ body: JSON.stringify(request), signal, headers: { 'Content-Type': 'application/json' } }));
  });

  it('maps each server refusal to wording a child can act on', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live'); vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const request = { category: { id: 'cat', name: 'Cat' }, idea: 'in a hat', references: ['data:image/png;base64,YQ=='] };
    for (const [status, code, expected] of [
      [429, 'busy', 'Lots of pictures are being made right now. Wait a moment and try again.'],
      [503, 'busy', 'Lots of pictures are being made right now. Wait a moment and try again.'],
      [429, 'limit', 'The workshop picture limit has been reached. Ask your teacher to reset it.'],
      [429, 'rate', 'That workshop code has made a lot of pictures very quickly. Wait a moment and try again.'],
      [401, 'unknown', 'Ask your teacher for the workshop code, then try again.'],
      [403, 'revoked', 'That workshop code is not in use any more. Ask your teacher for the new one.'],
      [403, 'expired', 'That workshop code has finished for today. Ask your teacher.'],
      [403, 'exhausted', 'That workshop code has made all of its pictures. Ask your teacher.'],
      [503, undefined, 'Picture making is not ready right now. Ask your workshop teacher.'],
      [502, undefined, 'The picture could not be made. Please try again in a little while.'],
    ] as const) {
      vi.resetModules();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ code }) }));
      const api = await import('./imageApi');
      await expect(api.requestImage(request, new AbortController().signal, 'FONTYS-A7K2M9PQ'))
        .rejects.toThrow(expected);
    }
  });

  it('never shows a child wording that came from the response body', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live'); vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ code: 'busy', error: 'ECONNRESET upstream portkey pool exhausted' }),
    }));
    const api = await import('./imageApi');
    await expect(api.requestImage({ category: { id: 'c', name: 'Cat' }, idea: 'x', references: [] }, new AbortController().signal, 'CODE'))
      .rejects.toThrow('Lots of pictures are being made right now. Wait a moment and try again.');
  });

  it('allows the server a queue wait plus a full generation before giving up', async () => {
    const { IMAGE_TIMEOUT_MS } = await import('./imageApi');
    // 120s of queue wait plus a 90s provider timeout, with room to spare.
    expect(IMAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000 + 90_000);
  });

  it('refuses a workshop code it could not put in a header', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live'); vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const api = await import('./imageApi');
    const request = { category: { id: 'cat', name: 'Cat' }, idea: 'in a hat', references: [] };
    for (const bad of ['has space', 'new\nline', 'caf\u00e9']) {
      await expect(api.requestImage(request, new AbortController().signal, bad)).rejects.toThrow('English letters');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-image or insecure response sources', async () => {
    const { isImageSource } = await import('./imageApi');
    expect(isImageSource('javascript:alert(1)')).toBe(false);
    expect(isImageSource('data:image/svg+xml;base64,YQ==')).toBe(false);
    expect(isImageSource('http://example.com/image.png')).toBe(false);
    expect(isImageSource('https://example.com/image.png')).toBe(true);
  });
});
