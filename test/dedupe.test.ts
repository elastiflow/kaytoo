import { describe, expect, it } from 'vitest';
import { DedupeStore } from '../src/state/dedupe.js';

describe('DedupeStore', () => {
  it('marks keys and expires them after TTL', () => {
    const store = new DedupeStore(1000);

    const t0 = 10_000;
    expect(store.has('a', t0)).toBe(false);

    store.mark('a', t0);
    expect(store.has('a', t0)).toBe(true);
    expect(store.has('a', t0 + 999)).toBe(true);
    expect(store.has('a', t0 + 1000)).toBe(false);
    expect(store.has('a', t0 + 2000)).toBe(false);
  });

  it('restore and snapshot round-trip non-expired keys', () => {
    const store = new DedupeStore(5000);
    const t0 = 50_000;
    store.mark('x', t0);
    store.mark('y', t0);
    const snap = store.snapshot(t0);
    const other = new DedupeStore(5000);
    other.restore(snap, t0);
    expect(other.has('x', t0)).toBe(true);
    expect(other.has('y', t0)).toBe(true);
    expect(other.has('x', t0 + 4999)).toBe(true);
    expect(other.has('x', t0 + 5000)).toBe(false);
  });
});
