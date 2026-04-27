import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getLogger, logErr } from '../logging/logger.js';
import { parseJsonOrNull } from '../util/json.js';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

export type StoredConversation = {
  turns: ConversationTurn[];
  /** Rolling summary of older turns to cap prompt size (omit when empty / cleared). */
  summary?: string;
  updatedAtMs: number;
};

export type ConversationStore = {
  load(key: string): Promise<StoredConversation | undefined>;
  save(key: string, data: StoredConversation): Promise<void>;
};

type FileStorePayload = { entries: Record<string, StoredConversation> };

function nowMs(): number {
  return Date.now();
}

function isStoredConversation(v: unknown): v is StoredConversation {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.turns) || typeof o.updatedAtMs !== 'number' || !Number.isFinite(o.updatedAtMs)) return false;
  for (const t of o.turns) {
    if (!t || typeof t !== 'object') return false;
    const tr = t as Record<string, unknown>;
    if (tr.role !== 'user' && tr.role !== 'assistant') return false;
    if (typeof tr.content !== 'string') return false;
  }
  if (o.summary !== undefined && typeof o.summary !== 'string') return false;
  return true;
}

/** JSON file-backed store; one mutex chain so concurrent updates cannot interleave read/write. */
export function createFileConversationStore(opts: {
  filePath: string;
  ttlMs: number;
}): ConversationStore {
  const { filePath, ttlMs } = opts;
  const log = getLogger({ component: 'storage.conversationStore' });
  const chain = { tail: Promise.resolve() };
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.tail.then(() => task());
    chain.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const prune = (payload: FileStorePayload): boolean => {
    const cutoff = nowMs() - ttlMs;
    const keys = Object.keys(payload.entries);
    const stale = keys.filter((k) => {
      const e = payload.entries[k];
      return !isStoredConversation(e) || e.updatedAtMs < cutoff;
    });
    for (const k of stale) delete payload.entries[k];
    return stale.length > 0;
  };

  const readAll = async (): Promise<FileStorePayload> => {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = parseJsonOrNull({
        raw,
        context: `conversationStore.readAll(${filePath})`,
        log,
      });
      if (parsed === null || !parsed || typeof parsed !== 'object') return { entries: {} };
      const entries = (parsed as FileStorePayload).entries;
      if (!entries || typeof entries !== 'object') return { entries: {} };
      return { entries: entries as Record<string, StoredConversation> };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return { entries: {} };
      log.warn({ ...logErr(e), filePath }, 'conversation store read failed');
      throw e;
    }
  };

  const writeAll = async (payload: FileStorePayload): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), 'utf8');
    await rename(tmp, filePath);
  };

  return {
    async load(key) {
      return enqueue(async () => {
        const payload = await readAll();
        if (prune(payload)) await writeAll(payload);
        const e = payload.entries[key];
        return isStoredConversation(e) ? e : undefined;
      });
    },

    async save(key, data) {
      await enqueue(async () => {
        const payload = await readAll();
        void prune(payload);
        const merged: StoredConversation = { ...data, updatedAtMs: nowMs() };
        if (!isStoredConversation(merged)) throw new Error('invalid conversation payload');
        payload.entries[key] = merged;
        await writeAll(payload);
      });
    },
  };
}

/** Non-persistent in-memory store (single process). */
export function createMemoryConversationStore(opts: { ttlMs: number }): ConversationStore {
  const map = new Map<string, StoredConversation>();
  const gc = { nextAtMs: 0 };
  const maybePrune = (): void => {
    const now = Date.now();
    if (now < gc.nextAtMs) return;
    gc.nextAtMs = now + 60_000;
    const cutoff = now - opts.ttlMs;
    for (const [k, e] of map) {
      if (!isStoredConversation(e) || e.updatedAtMs < cutoff) map.delete(k);
    }
  };
  return {
    async load(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (!isStoredConversation(e)) {
        map.delete(key);
        return undefined;
      }
      if (e.updatedAtMs < Date.now() - opts.ttlMs) {
        map.delete(key);
        return undefined;
      }
      return e;
    },
    async save(key, data) {
      maybePrune();
      const merged: StoredConversation = { ...data, updatedAtMs: Date.now() };
      if (!isStoredConversation(merged)) throw new Error('invalid conversation payload');
      map.set(key, merged);
    },
  };
}
