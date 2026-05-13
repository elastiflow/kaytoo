import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadInsightDedupeFile, saveInsightDedupeFile } from '../src/insights/insightDedupeFile.js';
import { DedupeStore } from '../src/state/dedupe.js';

describe('insightDedupeFile', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('load is no-op when file missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kaytoo-dedupe-'));
    const path = join(dir, 'missing.json');
    const store = new DedupeStore(60_000);
    await loadInsightDedupeFile(path, store);
    expect(store.has('any', Date.now())).toBe(false);
  });

  it('load restores valid entries; save writes snapshot', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kaytoo-dedupe-'));
    const path = join(dir, 'd.json');
    await writeFile(path, JSON.stringify([['a', Date.now() + 60_000]]), 'utf8');
    const store = new DedupeStore(60_000);
    await loadInsightDedupeFile(path, store);
    expect(store.has('a', Date.now())).toBe(true);

    store.mark('b', Date.now());
    await saveInsightDedupeFile(path, store);
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as [string, number][]).some((row) => row[0] === 'b')).toBe(true);
  });
});
