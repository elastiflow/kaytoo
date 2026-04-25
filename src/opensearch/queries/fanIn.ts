import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import {
  getBuckets,
  timedSearch,
  toNumber,
  toString,
  type AggBucket,
  type AggValue,
} from './shared.js';
import { internalDestinationIpBool } from './destinationIp.js';

function extractTopHitSource(bucket: AggBucket): Record<string, unknown> | undefined {
  const ex = bucket['example'];
  if (!ex || typeof ex !== 'object') return undefined;
  const hitsWrap = (ex as Record<string, unknown>)['hits'];
  if (!hitsWrap || typeof hitsWrap !== 'object') return undefined;
  const hitsArr = (hitsWrap as Record<string, unknown>)['hits'];
  if (!Array.isArray(hitsArr) || hitsArr.length === 0) return undefined;
  const h0 = hitsArr[0];
  if (!h0 || typeof h0 !== 'object') return undefined;
  const src = (h0 as Record<string, unknown>)['_source'];
  if (!src || typeof src !== 'object') return undefined;
  return src as Record<string, unknown>;
}

export type ServiceFanInRow = {
  dstIp: string;
  distinctSourceIps: number;
  distinctPodNamesApprox?: number;
  distinctClientNamespacesApprox?: number;
  bytes: number;
  docCount: number;
  sampleSource?: Record<string, unknown>;
};

/** Top destinations by distinct client/source IP count. */
export async function queryTopDestinationsByFanIn(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  minutesBack: number;
  size: number;
  internalDstOnly: boolean;
}): Promise<ServiceFanInRow[]> {
  const filter: Record<string, unknown>[] = [
    { range: { '@timestamp': { gte: `now-${opts.minutesBack}m`, lt: 'now' } } },
    ...(opts.internalDstOnly ? [internalDestinationIpBool(opts.fields.dstIpField) as never] : []),
  ];

  const subAggs: Record<string, unknown> = {
    distinct_src_ips: {
      cardinality: { field: opts.fields.srcIpField, precision_threshold: 4000 },
    },
    bytes: { sum: { field: opts.fields.bytesField } },
  };

  if (opts.fields.podNameField) {
    subAggs.distinct_pod_names = {
      cardinality: { field: opts.fields.podNameField, precision_threshold: 3000 },
    };
  }
  if (opts.fields.clientNamespaceField) {
    subAggs.distinct_client_namespaces = {
      cardinality: { field: opts.fields.clientNamespaceField, precision_threshold: 2000 },
    };
  }

  const includes = [
    opts.fields.srcIpField,
    opts.fields.dstIpField,
    opts.fields.bytesField,
    ...(opts.fields.podNameField ? [opts.fields.podNameField] : []),
    ...(opts.fields.clientNamespaceField ? [opts.fields.clientNamespaceField] : []),
  ];

  subAggs.example = {
    top_hits: {
      size: 1,
      sort: [{ '@timestamp': { order: 'desc' } }],
      _source: { includes: [...new Set(includes.filter(Boolean))] },
    },
  };

  const res = await timedSearch('queryTopDestinationsByFanIn', opts.client, {
    index: opts.index,
    size: 0,
    body: {
      query: { bool: { filter: filter as never } },
      aggs: {
        by_dst: {
          terms: {
            field: opts.fields.dstIpField,
            size: opts.size,
            order: { distinct_src_ips: 'desc' },
            shard_size: Math.min(5000, Math.max(opts.size * 80, 200)),
          },
          aggs: subAggs as never,
        },
      },
    } as never,
  });
  const body = (res as { body?: unknown } | null | undefined)?.body;

  return getBuckets(body as unknown, ['aggregations', 'by_dst', 'buckets']).map((b) => {
    const distinctIps = b['distinct_src_ips'] as AggValue | undefined;
    const distinctPods = b['distinct_pod_names'] as AggValue | undefined;
    const distinctNs = b['distinct_client_namespaces'] as AggValue | undefined;
    const bytesAgg = b['bytes'] as AggValue | undefined;
    const sampleSource = extractTopHitSource(b);
    const row: ServiceFanInRow = {
      dstIp: toString(b.key),
      distinctSourceIps: toNumber(distinctIps?.value),
      bytes: toNumber(bytesAgg?.value),
      docCount: toNumber(b['doc_count']),
      ...(sampleSource ? { sampleSource } : {}),
    };
    if (opts.fields.podNameField) row.distinctPodNamesApprox = toNumber(distinctPods?.value);
    if (opts.fields.clientNamespaceField) row.distinctClientNamespacesApprox = toNumber(distinctNs?.value);
    return row;
  });
}
