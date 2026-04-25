import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { clampMinutesBack, resolveToolIndexAndFields } from './common.js';
import { internalRfc1918DstIpFilter } from './internalRfc1918DstFilter.js';
import { baselineSubaggTimestampFilter } from './vsBaselineTimeFilters.js';

export async function destinationTrafficDropsVsBaseline(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields } = await resolveToolIndexAndFields({ ctx, args });

  const currentM = clampMinutesBack(typeof args.currentMinutesBack === 'number' ? args.currentMinutesBack : 15, ctx.policy);
  const baselineM = clampMinutesBack(
    typeof args.baselineMinutesBack === 'number' ? args.baselineMinutesBack : 7 * 24 * 60,
    ctx.policy,
  );
  const size = clampBucketSize(typeof args.size === 'number' ? args.size : 10, ctx.policy);
  const dropThreshold = typeof args.dropThreshold === 'number' ? args.dropThreshold : 0.5;
  const internalDstOnly = typeof args.internalDstOnly === 'boolean' ? args.internalDstOnly : true;

  if (!fields.dstIpField) {
    return { index, currentMinutesBack: currentM, baselineMinutesBack: baselineM, internalDstOnly, drops: [], note: 'Missing dst IP field.' };
  }

  const dstFilter = internalDstOnly ? [internalRfc1918DstIpFilter(fields.dstIpField)] : [];

  const baselineOffsetM = currentM;
  const expectedScale = currentM / baselineM;

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: `now-${currentM}m`, lt: 'now' } } },
            ...dstFilter,
          ],
        },
      },
      aggs: {
        by_dst: {
          terms: { field: fields.dstIpField, size, order: { sum_bytes: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            baseline: {
              filter: baselineSubaggTimestampFilter(baselineM, baselineOffsetM),
              aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
            },
          },
        },
      },
    } as never,
  });

  const rows = getAggBuckets(body, ['aggregations', 'by_dst', 'buckets']).map((b) => {
    const currentBytes = getNumber(getNested(b, ['sum_bytes', 'value']));
    const baselineBytes = getNumber(getNested(b, ['baseline', 'sum_bytes', 'value']));
    const expectedBytes = baselineBytes * expectedScale;
    const ratio = expectedBytes > 0 ? currentBytes / expectedBytes : null;
    return {
      dstIp: getString(b['key']),
      currentBytes,
      expectedBytes,
      ratioVsExpected: ratio,
      flows: getNumber(b['doc_count']),
    };
  });

  const drops = rows
    .filter((r) => r.ratioVsExpected !== null && r.ratioVsExpected < dropThreshold)
    .sort((a, b) => (a.ratioVsExpected ?? 1) - (b.ratioVsExpected ?? 1))
    .slice(0, size);

  return {
    index,
    currentMinutesBack: currentM,
    baselineMinutesBack: baselineM,
    baselineOffsetMinutes: baselineOffsetM,
    internalDstOnly,
    dropThreshold,
    note: 'expectedBytes = baselineBytes * (currentM/baselineM); baseline excludes current window.',
    drops,
  };
}

