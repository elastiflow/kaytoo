import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import { getBuckets, timedSearch, toNumber, toString, type AggValue } from './shared.js';

export type PortscanAggRow = { srcIp: string; distinctDstPorts: number; packets: number; bytes: number };

export async function queryPortscanCandidates(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  window: { from: string; to: string };
  size: number;
}): Promise<PortscanAggRow[]> {
  const res = await timedSearch('queryPortscanCandidates', opts.client, {
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
            distinct_dst_ports: { cardinality: { field: opts.fields.dstPortField } },
            packets: { sum: { field: opts.fields.packetsField ?? 'network.packets' } },
            bytes: { sum: { field: opts.fields.bytesField } },
          },
        },
      },
    },
  });
  const body = (res as { body?: unknown } | null | undefined)?.body;

  const buckets = getBuckets(body as unknown, ['aggregations', 'by_src', 'buckets']);
  return buckets.map((b) => {
    const distinctAgg = b['distinct_dst_ports'] as AggValue | undefined;
    const packetsAgg = b['packets'] as AggValue | undefined;
    const bytesAgg = b['bytes'] as AggValue | undefined;
    return {
      srcIp: toString(b.key),
      distinctDstPorts: toNumber(distinctAgg?.value),
      packets: toNumber(packetsAgg?.value),
      bytes: toNumber(bytesAgg?.value),
    };
  });
}
