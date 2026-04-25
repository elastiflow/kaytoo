import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createFileConversationStore, createMemoryConversationStore } from '../src/storage/conversationStore.js';

describe('createFileConversationStore', () => {
  it('load: missing file is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-cs-'));
    const filePath = join(dir, 'missing.json');
    const store = createFileConversationStore({ filePath, ttlMs: 86_400_000 });
    expect(await store.load('any')).toBeUndefined();
    await rm(dir, { recursive: true });
  });

  it('persists and reloads entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-store-'));
    const filePath = join(dir, 'c.json');
    const store = createFileConversationStore({ filePath, ttlMs: 86_400_000 });

    await store.save('k1', { turns: [{ role: 'user', content: 'hi' }], updatedAtMs: Date.now() });
    const store2 = createFileConversationStore({ filePath, ttlMs: 86_400_000 });
    const loaded = await store2.load('k1');
    expect(loaded?.turns).toHaveLength(1);
    expect(loaded?.turns[0]?.content).toBe('hi');

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { entries: Record<string, unknown> };
    expect(raw.entries.k1).toBeTruthy();

    await rm(dir, { recursive: true });
  });

  it('treats corrupt JSON as empty store then accepts new saves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-store-'));
    const filePath = join(dir, 'bad.json');
    await writeFile(filePath, '{ not json', 'utf8');
    const store = createFileConversationStore({ filePath, ttlMs: 86_400_000 });
    expect(await store.load('k1')).toBeUndefined();

    await store.save('k1', { turns: [{ role: 'user', content: 'ok' }], updatedAtMs: Date.now() });
    const loaded = await store.load('k1');
    expect(loaded?.turns[0]?.content).toBe('ok');

    await rm(dir, { recursive: true });
  });

  it('drops malformed entries on load and rewrites the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-store-'));
    const filePath = join(dir, 'malformed.json');
    const ts = Date.now();
    await writeFile(
      filePath,
      JSON.stringify({
        entries: {
          k1: { turns: 'nope', updatedAtMs: 1 },
          k2: { turns: [{ role: 'user', content: 'keep' }], updatedAtMs: ts },
        },
      }),
      'utf8',
    );
    const store = createFileConversationStore({ filePath, ttlMs: 86_400_000 });
    expect(await store.load('k2')).toMatchObject({ turns: [{ role: 'user', content: 'keep' }] });

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { entries: Record<string, unknown> };
    expect(raw.entries.k1).toBeUndefined();
    expect(raw.entries.k2).toBeTruthy();

    await rm(dir, { recursive: true });
  });

  it('prunes expired entries on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-cs-'));
    const filePath = join(dir, 'c.json');
    const old = Date.now() - 120_000;
    await writeFile(
      filePath,
      JSON.stringify({
        entries: {
          stale: { turns: [{ role: 'user', content: 'x' }], updatedAtMs: old },
          fresh: { turns: [{ role: 'user', content: 'y' }], updatedAtMs: Date.now() },
        },
      }),
      'utf8',
    );
    const store = createFileConversationStore({ filePath, ttlMs: 60_000 });
    expect(await store.load('stale')).toBeUndefined();
    expect(await store.load('fresh')).toMatchObject({ turns: [{ role: 'user', content: 'y' }] });
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { entries: Record<string, unknown> };
    expect(raw.entries.stale).toBeUndefined();
    await rm(dir, { recursive: true });
  });

  it('save rejects invalid payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-cs-'));
    const filePath = join(dir, 'c.json');
    const store = createFileConversationStore({ filePath, ttlMs: 86_400_000 });
    await expect(
      store.save(
        'k1',
        { turns: [{ role: 'user', content: 'x' }], summary: 1, updatedAtMs: 1 } as never,
      ),
    ).rejects.toThrow(/invalid conversation payload/);
    await rm(dir, { recursive: true });
  });
});

describe('createMemoryConversationStore', () => {
  it('TTL expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const store = createMemoryConversationStore({ ttlMs: 1000 });
    await store.save('k1', { turns: [{ role: 'user', content: 'a' }], updatedAtMs: Date.now() });
    vi.setSystemTime(new Date('2020-01-01T00:00:02Z'));
    expect(await store.load('k1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('save rejects invalid payload', async () => {
    const store = createMemoryConversationStore({ ttlMs: 60_000 });
    await expect(
      store.save('k', { turns: [{ role: 'user', content: 'x' }], summary: false, updatedAtMs: 1 } as never),
    ).rejects.toThrow(/invalid conversation payload/);
  });
});
