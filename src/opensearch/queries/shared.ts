import { getLogger, logErr } from '../../logging/logger.js';
import type { Client } from '@opensearch-project/opensearch';

export async function timedSearch(op: string, client: Client, params: Parameters<Client['search']>[0]) {
  const log = getLogger({ component: 'opensearch.queries', op });
  const indexLabel = (() => {
    if (!params || typeof params !== 'object') return '';
    const idx = (params as Record<string, unknown>)['index'];
    if (typeof idx === 'string') return idx;
    if (Array.isArray(idx)) return idx.filter((x): x is string => typeof x === 'string').join(',');
    return '';
  })();
  const t0 = Date.now();
  try {
    const res = await client.search(params);
    log.debug({ durationMs: Date.now() - t0, index: indexLabel }, 'search ok');
    return res;
  } catch (e) {
    log.warn({ durationMs: Date.now() - t0, index: indexLabel, ...logErr(e) }, 'search failed');
    throw e;
  }
}

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  return 0;
}

export function toString(v: unknown): string {
  if (typeof v === 'string') return v;
  return '';
}

export type AggValue = { value?: unknown };
export type AggBucket = Record<string, unknown> & { key?: unknown };

export function getNested(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((cur, p) => {
    if (!cur || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[p];
  }, obj);
}

export function getBuckets(body: unknown, path: string[]): AggBucket[] {
  const buckets = getNested(body, path);
  if (!Array.isArray(buckets)) return [];
  return buckets.filter((b): b is AggBucket => !!b && typeof b === 'object');
}
