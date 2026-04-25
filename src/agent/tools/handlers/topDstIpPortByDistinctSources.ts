import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function topDstIpPortByDistinctSources(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 20,
  });

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        dst: {
          multi_terms: {
            terms: [{ field: fields.dstIpField }, { field: fields.dstPortField }],
            size,
            order: { distinct_src: 'desc' },
          },
          aggs: {
            distinct_src: { cardinality: { field: fields.srcIpField, precision_threshold: 2000 } },
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(fields.protoField ? { top_proto: { terms: { field: fields.protoField, size: 1 } } } : {}),
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'dst', 'buckets']);
  return {
    index,
    minutesBack,
    destinations: buckets.map((b) => {
      const key = Array.isArray(b['key']) ? (b['key'] as unknown[]) : [];
      return {
        dstIp: getString(key[0]),
        dstPort: getNumber(key[1]),
        distinctSourcesApprox: getNumber(getNested(b, ['distinct_src', 'value'])),
        bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
        ...(fields.protoField
          ? {
              topProtocol: getString(getNested(getAggBuckets(b, ['top_proto', 'buckets'])[0], ['key'])),
            }
          : {}),
      };
    }),
  };
}

