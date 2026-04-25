import { getString } from '../../util/guards.js';

export function isRecordArgs(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function getNested(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((cur, p) => {
    if (!cur || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[p];
  }, obj);
}

export function getAggBuckets(body: unknown, path: string[]): Array<Record<string, unknown>> {
  const buckets = getNested(body, path);
  if (!Array.isArray(buckets)) return [];
  return buckets.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object');
}

export function summarizeHits(body: unknown): unknown {
  const hitsObj = getNested(body, ['hits']);
  const hits = getNested(hitsObj, ['hits']);
  if (!Array.isArray(hits)) return { hits: [] };
  return {
    total: getNested(hitsObj, ['total']),
    hits: hits.slice(0, 20).map((h) => {
      if (!h || typeof h !== 'object') return {};
      const ho = h as Record<string, unknown>;
      return {
        _index: getString(ho['_index']),
        _id: getString(ho['_id']),
        _source: ho['_source'],
        sort: ho['sort'],
      };
    }),
  };
}
