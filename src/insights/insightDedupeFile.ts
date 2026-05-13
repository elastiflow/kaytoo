import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DedupeStore } from '../state/dedupe.js';

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function loadInsightDedupeFile(path: string, store: DedupeStore): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if (isEnoent(e)) return;
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return;
  const tuples: [string, number][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [k, exp] = row;
    if (typeof k === 'string' && typeof exp === 'number' && Number.isFinite(exp)) tuples.push([k, exp]);
  }
  store.restore(tuples);
}

export async function saveInsightDedupeFile(path: string, store: DedupeStore): Promise<void> {
  const dir = dirname(path);
  if (dir && dir !== '.') await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(store.snapshot()), 'utf8');
}
