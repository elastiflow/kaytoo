import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import { externalDestinationIpBool } from './destinationIp.js';
import { getBuckets, timedSearch, toNumber, toString, topTermsLabelFromBucket, type AggValue } from './shared.js';

export type EgressAggRow = { srcIp: string; bytes: number; srcDisplayName?: string };

export async function queryTopEgressBySource(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  window: { from: string; to: string };
  size: number;
  /** When true, only count bytes to non-RFC1918/CGNAT destinations. */
  externalOnly?: boolean;
}): Promise<EgressAggRow[]> {
  const subField = opts.fields.srcDisplayNameField;
  const bySrc = subField
    ? {
        terms: { field: opts.fields.srcIpField, size: opts.size },
        aggs: {
          bytes: { sum: { field: opts.fields.bytesField } },
          top_src_display: {
            terms: { field: subField, size: 1, order: { lbl_bytes: 'desc' as const } },
            aggs: { lbl_bytes: { sum: { field: opts.fields.bytesField } } },
          },
        },
      }
    : {
        terms: { field: opts.fields.srcIpField, size: opts.size },
        aggs: { bytes: { sum: { field: opts.fields.bytesField } } },
      };

  const timeRange = {
    range: {
      '@timestamp': { gte: opts.window.from, lt: opts.window.to },
    },
  };
  const query = opts.externalOnly
    ? {
        bool: {
          filter: [timeRange, externalDestinationIpBool(opts.fields.dstIpField)],
        },
      }
    : timeRange;

  const res = await timedSearch('queryTopEgressBySource', opts.client, {
    index: opts.index,
    size: 0,
    body: {
      query,
      aggs: { by_src: bySrc },
    },
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
