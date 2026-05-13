import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import { getBuckets, timedSearch, toNumber, toString, topTermsLabelFromBucket, type AggValue } from './shared.js';

export type EgressAggRow = { srcIp: string; bytes: number; srcDisplayName?: string };

export async function queryTopEgressBySource(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  window: { from: string; to: string };
  size: number;
}): Promise<EgressAggRow[]> {
  const bySrcAggs: Record<string, unknown> = {
    bytes: { sum: { field: opts.fields.bytesField } },
  };
  const subField = opts.fields.srcDisplayNameField;
  if (subField) {
    bySrcAggs.top_src_display = {
      terms: { field: subField, size: 1, order: { lbl_bytes: 'desc' } },
      aggs: { lbl_bytes: { sum: { field: opts.fields.bytesField } } },
    };
  }

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
          aggs: bySrcAggs,
        },
      },
    } as never,
  });
  const body = (res as { body?: unknown } | null | undefined)?.body;

  const buckets = getBuckets(body as unknown, ['aggregations', 'by_src', 'buckets']);
  return buckets.map((b) => {
    const rec = b as Record<string, unknown>;
    const bytesAgg = rec['bytes'] as AggValue | undefined;
    const row: EgressAggRow = {
      srcIp: toString(rec.key),
      bytes: toNumber(bytesAgg?.value),
    };
    if (subField) {
      const dn = topTermsLabelFromBucket(rec, 'top_src_display');
      if (dn) row.srcDisplayName = dn;
    }
    return row;
  });
}
