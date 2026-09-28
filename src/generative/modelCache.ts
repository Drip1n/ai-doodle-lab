/**
 * A tiny bounded LRU cache for loaded models.
 *
 * AI Draws loads one Sketch-RNN model per category, and a long workshop can
 * easily touch a dozen of them. Keeping every one alive means keeping every
 * one's TensorFlow tensors alive, so the cache holds a fixed number and
 * disposes whatever falls out of the back.
 *
 * Two rules keep a dropped model from being one that is still in use:
 *   - a pinned key is never evicted (the caller holds it while generating);
 *   - the most recently used key is never evicted either.
 *
 * It is deliberately free of TensorFlow and of the DOM so the eviction rules
 * can be tested directly.
 */
export class ModelCache<T> {
  /** Map iterates in insertion order, so the first key is the oldest use. */
  private readonly entries = new Map<string, T>();
  private readonly pins = new Map<string, number>();

  private readonly limit: number;
  private readonly dispose: (value: T) => void;

  constructor(limit: number, dispose: (value: T) => void) {
    if (limit < 1) throw new Error('A model cache must hold at least one model.');
    this.limit = limit;
    this.dispose = dispose;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Returns the value and marks it as the most recently used. */
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /**
   * Stores a value, evicting the least recently used entries until the cache
   * is back within its limit. Replacing an existing key disposes the old
   * value, since nothing else owns it.
   */
  set(key: string, value: T): void {
    const previous = this.entries.get(key);
    if (previous !== undefined && previous !== value) this.dispose(previous);
    this.entries.delete(key);
    this.entries.set(key, value);
    this.evict();
  }

  /**
   * Protects a key from eviction. Safe to call before the value exists: the
   * pin is remembered for whenever it lands.
   */
  pin(key: string): void {
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
  }

  release(key: string): void {
    const count = this.pins.get(key);
    if (count === undefined) return;
    if (count <= 1) this.pins.delete(key);
    else this.pins.set(key, count - 1);
    this.evict();
  }

  isPinned(key: string): boolean {
    return (this.pins.get(key) ?? 0) > 0;
  }

  /** Keys from least to most recently used. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    for (const value of this.entries.values()) this.dispose(value);
    this.entries.clear();
    this.pins.clear();
  }

  private evict(): void {
    if (this.entries.size <= this.limit) return;
    const order = this.keys();
    // The last key is the newest -- the model the caller just asked for.
    const evictable = order.slice(0, -1);
    for (const key of evictable) {
      if (this.entries.size <= this.limit) break;
      if (this.isPinned(key)) continue;
      const value = this.entries.get(key)!;
      this.entries.delete(key);
      this.dispose(value);
    }
  }
}
