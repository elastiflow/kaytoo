import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { clampMinutesBack, resolveAggToolContext } from './common.js';
import { internalRfc1918DstIpFilter } from './internalRfc1918DstFilter.js';
import { baselineSubaggTimestampFilter } from './vsBaselineTimeFilters.js';

export async function topServiceFanInVsBaseline(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 10,
  });
  const baselineMinutesBack = clampMinutesBack(
    typeof args.baselineMinutesBack === 'number' ? args.baselineMinutesBack : 7 * 24 * 60,
    ctx.policy,
  );
  const internalDstOnly = typeof args.internalDstOnly === 'boolean' ? args.internalDstOnly : true;

  if (!fields.srcIpField || !fields.dstIpField) {
    return { index, minutesBack, baselineMinutesBack, internalDstOnly, destinations: [], note: 'Missing src/dst IP fields.' };
  }

  const dstFilter = internalDstOnly ? [internalRfc1918DstIpFilter(fields.dstIpField)] : [];

  const baselineOffsetM = minutesBack;
  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } },
            ...dstFilter,
          ],
        },
      },
      aggs: {
        by_dst: {
          terms: { field: fields.dstIpField, size, order: { distinct_sources: 'desc' } },
          aggs: {
            distinct_sources: { cardinality: { field: fields.srcIpField } },
            sum_bytes: { sum: { field: fields.bytesField } },
            baseline: {
              filter: baselineSubaggTimestampFilter(baselineMinutesBack, baselineOffsetM),
              aggs: {
                distinct_sources: { cardinality: { field: fields.srcIpField } },
                sum_bytes: { sum: { field: fields.bytesField } },
              },
            },
          },
        },
      },
    } as never,
  });

  const dests = getAggBuckets(body, ['aggregations', 'by_dst', 'buckets']).map((b) => {
    const curSources = getNumber(getNested(b, ['distinct_sources', 'value']));
    const baseSources = getNumber(getNested(b, ['baseline', 'distinct_sources', 'value']));
    const curBytes = getNumber(getNested(b, ['sum_bytes', 'value']));
    const baseBytes = getNumber(getNested(b, ['baseline', 'sum_bytes', 'value']));
    const ratio = baseSources > 0 ? curSources / baseSources : null;
    return {
      dstIp: getString(b['key']),
      current: { distinctSources: curSources, bytes: curBytes, flows: getNumber(b['doc_count']) },
      baseline: { distinctSources: baseSources, bytes: baseBytes },
      ratioDistinctSources: ratio,
    };
  });

  return {
    index,
    minutesBack,
    baselineMinutesBack,
    baselineOffsetMinutes: baselineOffsetM,
    internalDstOnly,
    note: 'Baseline excludes current window; ratio = distinctSources(now)/distinctSources(baseline).',
    destinations: dests,
  };
}

