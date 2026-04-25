import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function ddosCandidates(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 10,
  });

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_dst: {
          terms: { field: fields.dstIpField, size, order: { distinct_src: 'desc' } },
          aggs: {
            distinct_src: { cardinality: { field: fields.srcIpField, precision_threshold: 2000 } },
            sum_bytes: { sum: { field: fields.bytesField } },
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_dst', 'buckets']);
  return {
    index,
    minutesBack,
    destinations: buckets.map((b) => ({
      dstIp: getString(b['key']),
      distinctSourcesApprox: getNumber(getNested(b, ['distinct_src', 'value'])),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      flows: getNumber(b['doc_count']),
    })),
  };
}

