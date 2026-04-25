import { getNumber, getString } from '../../../util/guards.js';
import type { SearchClient } from '../../../search/types.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { internalRfc1918DstIpFilter } from './internalRfc1918DstFilter.js';
import { resolveAggToolContext } from './common.js';

export async function topFanOut(
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 10,
  });
  const internalDstOnly = args.internalDstOnly === true;
  const includeTopDestinations = args.includeTopDestinations === true;
  const topDestinationsSize = clampBucketSize(
    typeof args.topDestinationsSize === 'number' ? args.topDestinationsSize : 5,
    ctx.policy,
  );

  const timeFilter = { range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } };
  const dstFilter = internalDstOnly ? [internalRfc1918DstIpFilter(fields.dstIpField)] : [];
  const query = { bool: { filter: [timeFilter, ...dstFilter] } };

  const bySrcAggs: Record<string, unknown> = {
    distinct_dst: { cardinality: { field: fields.dstIpField, precision_threshold: 2000 } },
    sum_bytes: { sum: { field: fields.bytesField } },
  };
  if (includeTopDestinations) {
    bySrcAggs.top_dst_ips = {
      terms: {
        field: fields.dstIpField,
        size: topDestinationsSize,
        order: { dst_bytes: 'desc' },
      },
      aggs: {
        dst_bytes: { sum: { field: fields.bytesField } },
      },
    };
  }

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query,
      aggs: {
        by_src: {
          terms: { field: fields.srcIpField, size, order: { distinct_dst: 'desc' } },
          aggs: bySrcAggs,
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_src', 'buckets']);
  return {
    index,
    minutesBack,
    ...(internalDstOnly ? { internalDstOnly: true } : {}),
    ...(includeTopDestinations ? { includeTopDestinations: true, topDestinationsSize } : {}),
    sources: buckets.map((b) => ({
      srcIp: getString(b['key']),
      distinctDestinationsApprox: getNumber(getNested(b, ['distinct_dst', 'value'])),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      flows: getNumber(b['doc_count']),
      ...(includeTopDestinations
        ? {
            topDestinations: getAggBuckets(b, ['top_dst_ips', 'buckets']).map((nb) => ({
              dstIp: getString(nb['key']),
              bytes: getNumber(getNested(nb, ['dst_bytes', 'value'])),
              flows: getNumber(nb['doc_count']),
            })),
          }
        : {}),
    })),
  };
}

