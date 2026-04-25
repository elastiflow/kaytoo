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
});
