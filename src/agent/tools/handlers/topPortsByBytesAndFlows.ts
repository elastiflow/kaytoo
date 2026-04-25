import type { Client } from '@opensearch-project/opensearch';
import { getNumber } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function topPortsByBytesAndFlows(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 15,
  });

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_bytes: {
          terms: { field: fields.dstPortField, size, order: { sum_bytes: 'desc' } },
          aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
        },
        by_flows: {
          terms: { field: fields.dstPortField, size, order: { _count: 'desc' } },
          aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
        },
        ...(fields.protoField
          ? {
              proto_by_bytes: {
                terms: { field: fields.protoField, size, order: { sum_bytes: 'desc' } },
                aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
              },
              proto_by_flows: { terms: { field: fields.protoField, size, order: { _count: 'desc' } } },
            }
          : {}),
      },
    } as never,
  });

  const byBytes = getAggBuckets(body, ['aggregations', 'by_bytes', 'buckets']).map((b) => ({
    dstPort: getNumber(b['key']),
    bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
    flows: getNumber(b['doc_count']),
  }));
  const byFlows = getAggBuckets(body, ['aggregations', 'by_flows', 'buckets']).map((b) => ({
    dstPort: getNumber(b['key']),
    flows: getNumber(b['doc_count']),
    bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
  }));
  const protoByBytes = getAggBuckets(body, ['aggregations', 'proto_by_bytes', 'buckets']).map((b) => ({
    protocol: String(b['key'] ?? ''),
    bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
    flows: getNumber(b['doc_count']),
  }));
  const protoByFlows = getAggBuckets(body, ['aggregations', 'proto_by_flows', 'buckets']).map((b) => ({
    protocol: String(b['key'] ?? ''),
    flows: getNumber(b['doc_count']),
  }));

  return { index, minutesBack, byBytes, byFlows, ...(fields.protoField ? { protoByBytes, protoByFlows } : {}) };
}

