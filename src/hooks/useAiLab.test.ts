import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedPicture } from '../types';

/**
 * The lifecycle of the latest generated picture, at the level that owns it.
 *
 * MobileNet and IndexedDB are both stubbed: what is under test is where the
 * picture lives, when it is written, and what Reset does to it.
 */

vi.mock('../ml/classifier', () => ({
  loadModel: vi.fn(async () => {}),
  rebuildFrom: vi.fn(),
  addExample: vi.fn(),
  embedToArray: vi.fn(async () => new Float32Array(2)),
  predict: vi.fn(async () => ({ classId: 'cat', confidences: {} })),
  removeClass: vi.fn(),
  resetClassifier: vi.fn(),
}));

const store = vi.hoisted(() => ({ latest: null as unknown }));

vi.mock('../storage/db', () => ({
  isAvailable: vi.fn(async () => true),
  loadExamples: vi.fn(async () => []),
  loadClasses: vi.fn(async () => [{ id: 'cat', name: 'Cat', accent: '#000', accentSoft: '#fff' }]),
  loadStats: vi.fn(async () => null),
  loadMemoryStats: vi.fn(async () => null),
  loadAiDrawStats: vi.fn(async () => null),
  loadLatestCreation: vi.fn(async () => store.latest),
  saveLatestCreation: vi.fn(async (picture: GeneratedPicture) => { store.latest = picture; }),
  clearLatestCreation: vi.fn(async () => { store.latest = null; }),
  saveClasses: vi.fn(async () => {}),
  saveExample: vi.fn(async () => {}),
  deleteExample: vi.fn(async () => {}),
  clearExamples: vi.fn(async () => {}),
  clearMeta: vi.fn(async () => { store.latest = null; }),
  saveStats: vi.fn(async () => {}),
  saveMemoryStats: vi.fn(async () => {}),
  saveAiDrawStats: vi.fn(async () => {}),
}));

const DATA_IMAGE = 'data:image/png;base64,YQ==';
const SHARE_PATH = `/api/shared-image/${'A'.repeat(43)}`;

const stored = (overrides: Partial<GeneratedPicture> = {}): GeneratedPicture => ({
  image: DATA_IMAGE,
  categoryId: 'cat',
  categoryName: 'Cat',
  prompt: 'Create a picture of my cat: rainbow colours.',
  createdAt: 1_700_000_000_000,
  ...overrides,
});

async function boot() {
  const { useAiLab } = await import('./useAiLab');
  const view = renderHook(() => useAiLab());
  await waitFor(() => expect(view.result.current.modelStatus.state).toBe('ready'));
  return view;
}

beforeEach(() => { store.latest = null; vi.clearAllMocks(); vi.resetModules(); });
afterEach(() => { store.latest = null; });

describe('the latest generated picture', () => {
  it('enters the lab state and is written to storage when we hold its bytes', async () => {
    const db = await import('../storage/db');
    const view = await boot();
    expect(view.result.current.latestCreation).toBeNull();

    act(() => view.result.current.rememberCreation({
      image: DATA_IMAGE,
      categoryId: 'cat',
      categoryName: 'Cat',
      prompt: 'Create a picture of my cat: rainbow colours.',
      sharePath: SHARE_PATH,
      shareExpiresAt: Date.now() + 60_000,
    }));

    const picture = view.result.current.latestCreation!;
    expect(picture.image).toBe(DATA_IMAGE);
    expect(picture.prompt).toBe('Create a picture of my cat: rainbow colours.');
    expect(picture.categoryName).toBe('Cat');
    expect(picture.sharePath).toBe(SHARE_PATH);
    expect(picture.createdAt).toBeGreaterThan(0);
    await waitFor(() => expect(db.saveLatestCreation).toHaveBeenCalledWith(picture));
  });

  it('keeps a provider URL for the session only, rather than promising a reload', async () => {
    const db = await import('../storage/db');
    const view = await boot();
    act(() => view.result.current.rememberCreation({
      image: 'https://images.example/picture.png',
      categoryId: 'cat',
      categoryName: 'Cat',
      prompt: 'Create a picture of my cat: golden colours.',
    }));

    expect(view.result.current.latestCreation?.image).toBe('https://images.example/picture.png');
    expect(db.saveLatestCreation).not.toHaveBeenCalled();
    await waitFor(() => expect(db.clearLatestCreation).toHaveBeenCalled());
  });

  it('drops an expired phone link on the way in, and keeps the picture', async () => {
    const view = await boot();
    act(() => view.result.current.rememberCreation({
      image: DATA_IMAGE,
      categoryId: 'cat',
      categoryName: 'Cat',
      prompt: 'Create a picture of my cat.',
      sharePath: SHARE_PATH,
      shareExpiresAt: Date.now() - 1,
    }));
    expect(view.result.current.latestCreation?.image).toBe(DATA_IMAGE);
    expect(view.result.current.latestCreation?.sharePath).toBeUndefined();
  });

  it('comes back after a reload, caption and all', async () => {
    store.latest = stored({ prompt: 'Create a picture of my cat: on the Moon.' });
    const view = await boot();
    expect(view.result.current.latestCreation).toEqual(store.latest);
    expect(view.result.current.latestCreation?.prompt).toBe('Create a picture of my cat: on the Moon.');
  });

  it('forgets a stored row it cannot trust, instead of showing it', async () => {
    const db = await import('../storage/db');
    store.latest = { image: 'javascript:alert(1)', categoryId: 'cat', categoryName: 'Cat', prompt: 'x', createdAt: 1 };
    const view = await boot();
    expect(view.result.current.latestCreation).toBeNull();
    await waitFor(() => expect(db.clearLatestCreation).toHaveBeenCalled());
  });

  it('is cleared by Reset AI, in memory and in storage', async () => {
    const db = await import('../storage/db');
    store.latest = stored();
    const view = await boot();
    expect(view.result.current.latestCreation).not.toBeNull();

    await act(async () => { await view.result.current.reset(); });

    expect(view.result.current.latestCreation).toBeNull();
    expect(db.clearMeta).toHaveBeenCalled();
    expect(store.latest).toBeNull();
  });

  it('is cleared on request, for a picture the browser could not display', async () => {
    const db = await import('../storage/db');
    store.latest = stored();
    const view = await boot();
    act(() => view.result.current.forgetCreation());
    expect(view.result.current.latestCreation).toBeNull();
    await waitFor(() => expect(db.clearLatestCreation).toHaveBeenCalled());
    expect(store.latest).toBeNull();
  });
});
