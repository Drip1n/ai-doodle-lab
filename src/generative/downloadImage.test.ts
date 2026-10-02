import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadImage, pictureFileName } from './downloadImage';

const DATA_URL = 'data:image/png;base64,YQ==';

/** Captures what the helper handed the anchor, without leaving jsdom. */
function spyOnAnchor() {
  const clicks: { href: string; download: string; inDocument: boolean }[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({
      href: this.getAttribute('href') ?? '',
      download: this.download,
      // Firefox ignores a click on a detached anchor, so this matters.
      inDocument: document.body.contains(this),
    });
  });
  return { clicks, restore: () => click.mockRestore() };
}

/**
 * jsdom has no object-URL support, so these are installed by hand. Replacing
 * the whole `URL` global would break `new URL(...)`, which `isImageSource`
 * relies on, so only the two static methods are swapped.
 */
interface ObjectUrlApi {
  createObjectURL?: (object: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}
const urlApi = URL as unknown as ObjectUrlApi;

let created: string[];
let revoked: string[];
let originals: ObjectUrlApi;

beforeEach(() => {
  created = [];
  revoked = [];
  originals = { createObjectURL: urlApi.createObjectURL, revokeObjectURL: urlApi.revokeObjectURL };
  urlApi.createObjectURL = () => { const url = `blob:mock/${created.length}`; created.push(url); return url; };
  urlApi.revokeObjectURL = (url) => { revoked.push(url); };
});
afterEach(() => {
  urlApi.createObjectURL = originals.createObjectURL;
  urlApi.revokeObjectURL = originals.revokeObjectURL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pictureFileName', () => {
  it('builds a safe name from the category the child chose', () => {
    expect(pictureFileName('Cat')).toBe('ai-doodle-cat.png');
    expect(pictureFileName('Flying Cat')).toBe('ai-doodle-flying-cat.png');
    expect(pictureFileName('Café')).toBe('ai-doodle-cafe.png');
  });

  it('never lets a category name escape the filename', () => {
    // Category names are typed by children and are not trusted anywhere else
    // either, so path separators and the like must not survive.
    expect(pictureFileName('../../etc/passwd')).toBe('ai-doodle-etc-passwd.png');
    expect(pictureFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('ai-doodle-a-b-c-d-e-f-g-h-i-j.png');
    expect(pictureFileName('.hidden')).toBe('ai-doodle-hidden.png');
    expect(pictureFileName('   ')).toBe('ai-doodle-picture.png');
    expect(pictureFileName('')).toBe('ai-doodle-picture.png');
    expect(pictureFileName('🐱🐱🐱')).toBe('ai-doodle-picture.png');
    expect(pictureFileName('x'.repeat(200))).toBe(`ai-doodle-${'x'.repeat(40)}.png`);
    for (const name of ['../../etc/passwd', 'a/b\\c', '🐱', 'x'.repeat(200)]) {
      expect(pictureFileName(name)).toMatch(/^ai-doodle-[a-z0-9-]*\.png$/);
    }
  });
});

describe('downloadImage', () => {
  it('saves a data: picture straight from the anchor, with no fetch', async () => {
    const anchor = spyOnAnchor();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await downloadImage(DATA_URL, 'ai-doodle-cat.png');
      expect(anchor.clicks).toEqual([{ href: DATA_URL, download: 'ai-doodle-cat.png', inDocument: true }]);
      expect(fetchMock).not.toHaveBeenCalled();
      // No object URL is involved, so none is leaked.
      expect(created).toEqual([]);
    } finally { anchor.restore(); }
  });

  it('fetches an https: picture, saves the blob and revokes the object URL', async () => {
    const anchor = spyOnAnchor();
    const blob = new Blob(['png-bytes'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await downloadImage('https://images.example/picture.png', 'ai-doodle-cat.png');
      expect(fetchMock).toHaveBeenCalledWith('https://images.example/picture.png');
      expect(created).toEqual(['blob:mock/0']);
      expect(anchor.clicks).toEqual([{ href: 'blob:mock/0', download: 'ai-doodle-cat.png', inDocument: true }]);
      // The object URL must not be left behind.
      expect(revoked).toEqual(['blob:mock/0']);
    } finally { anchor.restore(); }
  });

  it('revokes the object URL even when saving throws', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('boom'); });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) }));
    try {
      await expect(downloadImage('https://images.example/p.png', 'x.png')).rejects.toThrow('boom');
      expect(revoked).toEqual(['blob:mock/0']);
    } finally { click.mockRestore(); }
  });

  it('refuses any source that is not a picture we would display', async () => {
    const anchor = spyOnAnchor();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      for (const bad of [
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/svg+xml;base64,YQ==',
        'http://images.example/p.png',
        'blob:https://evil.example/1234',
        '',
      ]) {
        await expect(downloadImage(bad, 'x.png'), `must refuse ${bad}`).rejects.toThrow('cannot be saved');
      }
      expect(anchor.clicks).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { anchor.restore(); }
  });

  it('reports a failed fetch rather than saving an empty file', async () => {
    const anchor = spyOnAnchor();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    try {
      await expect(downloadImage('https://images.example/gone.png', 'x.png')).rejects.toThrow('could not be fetched');
      expect(anchor.clicks).toEqual([]);
      expect(created).toEqual([]);
    } finally { anchor.restore(); }
  });
});
