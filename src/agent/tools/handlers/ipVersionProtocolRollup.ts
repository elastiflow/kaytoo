import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function ipVersionProtocolRollup(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });
  const ipV = fields.ipVersionField;
  if (!ipV) return { index, minutesBack, rows: [], note: 'No ipVersion field mapped.' };

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_ipver: {
          terms: { field: ipV, size },
          aggs: {
            ...(fields.protoField
              ? {
                  by_proto: {
                    terms: { field: fields.protoField, size },
                    aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
                  },
                }
              : {}),
            sum_bytes: { sum: { field: fields.bytesField } },
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_ipver', 'buckets']);
  return {
    index,
    minutesBack,
    ipVersionField: ipV,
    rows: buckets.map((b) => ({
      ipVersion: getString(b['key']),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      flows: getNumber(b['doc_count']),
      byProtocol: getAggBuckets(b, ['by_proto', 'buckets']).map((pb) => ({
        protocol: getString(pb['key']),
        bytes: getNumber(getNested(pb, ['sum_bytes', 'value'])),
        flows: getNumber(pb['doc_count']),
      })),
    })),
  };
}

