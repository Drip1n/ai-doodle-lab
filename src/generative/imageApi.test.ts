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

  it('rejects non-image or insecure response sources', async () => {
    const { isImageSource } = await import('./imageApi');
    expect(isImageSource('javascript:alert(1)')).toBe(false);
    expect(isImageSource('data:image/svg+xml;base64,YQ==')).toBe(false);
    expect(isImageSource('http://example.com/image.png')).toBe(false);
    expect(isImageSource('https://example.com/image.png')).toBe(true);
  });
});
