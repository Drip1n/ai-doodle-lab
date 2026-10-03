// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasLiveShare, isDurable, restoreCreation, withoutExpiredShare } from './latestCreation';
import type { GeneratedPicture } from '../types';

const TOKEN = 'A'.repeat(43);
const SHARE_PATH = `/api/shared-image/${TOKEN}`;

const picture = (overrides: Partial<GeneratedPicture> = {}): GeneratedPicture => ({
  image: 'data:image/png;base64,YQ==',
  categoryId: 'cat',
  categoryName: 'Cat',
  prompt: 'Create a picture of my cat: rainbow colours.',
  createdAt: 1_700_000_000_000,
  ...overrides,
});

describe('the latest creation', () => {
  it('only promises a reload for bytes we hold ourselves', () => {
    expect(isDurable(picture())).toBe(true);
    expect(isDurable(picture({ image: 'https://images.example/picture.png' }))).toBe(false);
  });

  it('comes back from storage with its own caption, not the current choices', () => {
    const stored = picture({ prompt: 'Create a picture of my cat: golden colours, on the Moon.' });
    expect(restoreCreation(stored)).toEqual(stored);
  });

  it('refuses a stored row that is not a usable picture', () => {
    for (const bad of [
      null, undefined, 'a string', 42, {},
      // A provider URL: it may be dead by now, and showing a child a broken
      // image labelled as their picture is worse than showing nothing.
      picture({ image: 'https://images.example/picture.png' }),
      picture({ image: 'javascript:alert(1)' as string }),
      picture({ image: 'data:image/svg+xml;base64,YQ==' }),
      picture({ image: 'blob:http://localhost/abc' }),
      picture({ categoryId: '' }),
      picture({ categoryName: '' }),
      picture({ prompt: '' }),
      { ...picture(), createdAt: 'yesterday' },
      { ...picture(), image: undefined },
    ]) {
      expect(restoreCreation(bad)).toBeNull();
    }
  });

  it('keeps a live phone link and drops an expired one without losing the picture', () => {
    const live = picture({ sharePath: SHARE_PATH, shareExpiresAt: 2_000 });
    expect(restoreCreation(live, 1_999)).toEqual(live);
    expect(hasLiveShare(live, 1_999)).toBe(true);

    const restored = restoreCreation(live, 2_000);
    expect(restored).toEqual(picture());
    expect(restored?.sharePath).toBeUndefined();
    expect(restored?.shareExpiresAt).toBeUndefined();
    expect(hasLiveShare(live, 2_000)).toBe(false);
    expect(hasLiveShare(null)).toBe(false);
  });

  it('ignores share metadata that does not look like one of ours', () => {
    for (const share of [
      { sharePath: 'https://evil.example/steal.png', shareExpiresAt: 9_999 },
      { sharePath: '/api/shared-image/short', shareExpiresAt: 9_999 },
      { sharePath: SHARE_PATH },
      { shareExpiresAt: 9_999 },
    ]) {
      const restored = restoreCreation(picture(share as Partial<GeneratedPicture>), 1_000);
      expect(restored).toEqual(picture());
    }
  });

  it('leaves a picture that never had a phone link exactly as it is', () => {
    const plain = picture();
    expect(withoutExpiredShare(plain, 1_000)).toBe(plain);
  });
});
