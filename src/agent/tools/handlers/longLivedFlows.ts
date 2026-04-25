import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function longLivedFlows(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });
  const dur = fields.durationMsField;
  if (!dur) return { index, minutesBack, flows: [], note: 'No duration field mapped.' };

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_flow: {
          multi_terms: {
            terms: [
              { field: fields.srcIpField },
              { field: fields.dstIpField },
              { field: fields.dstPortField },
              ...(fields.protoField ? [{ field: fields.protoField }] : []),
            ],
            size,
            order: { max_dur: 'desc' },
          },
          aggs: {
            max_dur: { max: { field: dur } },
            sum_bytes: { sum: { field: fields.bytesField } },
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_flow', 'buckets']);
  return {
    index,
    minutesBack,
    durationField: dur,
    flows: buckets.map((b) => {
      const key = Array.isArray(b['key']) ? (b['key'] as unknown[]) : [];
      return {
        srcIp: getString(key[0]),
        dstIp: getString(key[1]),
        dstPort: getNumber(key[2]),
        ...(fields.protoField ? { protocol: getString(key[3]) } : {}),
        durationMax: getNumber(getNested(b, ['max_dur', 'value'])),
        bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
        flows: getNumber(b['doc_count']),
      };
    }),
  };
}

