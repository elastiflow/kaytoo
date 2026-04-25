import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import { getBuckets, timedSearch, toNumber, toString, type AggValue } from './shared.js';

export type EgressAggRow = { srcIp: string; bytes: number };

export async function queryTopEgressBySource(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  window: { from: string; to: string };
  size: number;
}): Promise<EgressAggRow[]> {
  const res = await timedSearch('queryTopEgressBySource', opts.client, {
    index: opts.index,
    size: 0,
    body: {
      query: {
        range: {
          '@timestamp': { gte: opts.window.from, lt: opts.window.to },
        },
      },
      aggs: {
        by_src: {
          terms: { field: opts.fields.srcIpField, size: opts.size },
          aggs: {
            bytes: { sum: { field: opts.fields.bytesField } },
          },
        },
      },
    },
  });
  const body = (res as { body?: unknown } | null | undefined)?.body;

  const buckets = getBuckets(body as unknown, ['aggregations', 'by_src', 'buckets']);
  return buckets.map((b) => {
    const bytesAgg = b['bytes'] as AggValue | undefined;
    return {
      srcIp: toString(b.key),
      bytes: toNumber(bytesAgg?.value),
    };
  });
}
