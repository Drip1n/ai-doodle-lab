import { beforeEach, describe, expect, it } from 'vitest';
import { ModelCache } from './modelCache';

describe('ModelCache', () => {
  let disposed: string[];
  const make = (limit: number) => new ModelCache<string>(limit, (value) => disposed.push(value));

  beforeEach(() => {
    disposed = [];
  });

  it('refuses a limit below one', () => {
    expect(() => new ModelCache<string>(0, () => {})).toThrow();
  });

  it('keeps everything while under the limit', () => {
    const cache = make(5);
    for (const id of ['a', 'b', 'c']) cache.set(id, id);
    expect(cache.size).toBe(3);
    expect(disposed).toEqual([]);
    expect(cache.get('b')).toBe('b');
  });

  it('evicts and disposes the least recently used model when full', () => {
    const cache = make(5);
    for (const id of ['a', 'b', 'c', 'd', 'e']) cache.set(id, id);
    cache.set('f', 'f');

    expect(cache.size).toBe(5);
    expect(disposed).toEqual(['a']);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('f')).toBe(true);
  });

  it('counts a read as a use, so a re-read model outlives an older one', () => {
    const cache = make(3);
    for (const id of ['a', 'b', 'c']) cache.set(id, id);
    cache.get('a');
    cache.set('d', 'd');

    expect(disposed).toEqual(['b']);
    expect(cache.keys()).toEqual(['c', 'a', 'd']);
  });

  it('never evicts the model that was just stored', () => {
    const cache = make(1);
    cache.set('a', 'a');
    cache.set('b', 'b');

    expect(disposed).toEqual(['a']);
    expect(cache.keys()).toEqual(['b']);
  });

  it('never evicts a pinned model', () => {
    const cache = make(2);
    cache.set('a', 'a');
    cache.pin('a');
    cache.set('b', 'b');
    cache.set('c', 'c');

    expect(disposed).toEqual(['b']);
    expect(cache.has('a')).toBe(true);
  });

  it('makes a model evictable again once its last pin is released', () => {
    const cache = make(2);
    cache.pin('a');
    cache.pin('a');
    cache.set('a', 'a');
    cache.set('b', 'b');
    // 'a' is the oldest, but pinned, so the newer 'b' goes instead.
    cache.set('c', 'c');
    expect(disposed).toEqual(['b']);
    expect(cache.has('a')).toBe(true);

    cache.release('a');
    expect(cache.isPinned('a')).toBe(true);
    cache.release('a');
    expect(cache.isPinned('a')).toBe(false);

    cache.set('d', 'd');
    expect(disposed).toEqual(['b', 'a']);
    expect(cache.keys()).toEqual(['c', 'd']);
  });

  it('holds more than the limit only while everything is pinned', () => {
    const cache = make(2);
    for (const id of ['a', 'b', 'c']) {
      cache.pin(id);
      cache.set(id, id);
    }
    expect(cache.size).toBe(3);
    expect(disposed).toEqual([]);

    cache.release('a');
    expect(disposed).toEqual(['a']);
  });

  it('releasing an unknown key does nothing', () => {
    const cache = make(2);
    cache.set('a', 'a');
    cache.release('nope');
    expect(cache.has('a')).toBe(true);
    expect(disposed).toEqual([]);
  });

  it('disposes the old value when a key is replaced', () => {
    const cache = make(2);
    cache.set('a', 'first');
    cache.set('a', 'second');

    expect(disposed).toEqual(['first']);
    expect(cache.get('a')).toBe('second');
    expect(cache.size).toBe(1);
  });

  it('does not dispose when the same value is stored again', () => {
    const cache = make(2);
    cache.set('a', 'same');
    cache.set('a', 'same');
    expect(disposed).toEqual([]);
  });

  it('disposes everything on clear and forgets pins', () => {
    const cache = make(3);
    cache.set('a', 'a');
    cache.pin('a');
    cache.set('b', 'b');
    cache.clear();

    expect(disposed).toEqual(['a', 'b']);
    expect(cache.size).toBe(0);
    expect(cache.isPinned('a')).toBe(false);
  });
});
