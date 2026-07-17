import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import { externalDestinationIpBool } from './destinationIp.js';
import { getBuckets, timedSearch, toNumber, toString, type AggValue } from './shared.js';

export type RareDestAggRow = { dstIp: string; score: number; docCount: number; bytes: number };

export async function queryRareDestinationsSignificantTerms(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  window: { from: string; to: string };
  backgroundWindow: { from: string; to: string };
  size: number;
}): Promise<RareDestAggRow[]> {
  const external = externalDestinationIpBool(opts.fields.dstIpField);
  const res = await timedSearch('queryRareDestinationsSignificantTerms', opts.client, {
    index: opts.index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: opts.window.from, lt: opts.window.to } } },
            external,
          ],
        },
      },
      aggs: {
        sig_dests: {
          significant_terms: {
            field: opts.fields.dstIpField,
            size: opts.size,
            background_filter: {
              bool: {
                filter: [
                  {
                    range: {
                      '@timestamp': { gte: opts.backgroundWindow.from, lt: opts.backgroundWindow.to },
                    },
                  },
                  external,
                ],
              },
            },
          },
          aggs: {
            bytes: { sum: { field: opts.fields.bytesField } },
          },
        },
      },
    },
  });
  const body = (res as { body?: unknown } | null | undefined)?.body;

  return getBuckets(body as unknown, ['aggregations', 'sig_dests', 'buckets'])
    .map((b) => {
      const bytesAgg = b['bytes'] as AggValue | undefined;
      return {
        dstIp: toString(b['key']),
        score: toNumber(b['score']),
        docCount: toNumber(b['doc_count']),
        bytes: toNumber(bytesAgg?.value),
      };
    })
    .filter((r) => !!r.dstIp);
}
