import type { Client } from '@opensearch-project/opensearch';
import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import { getNumber, getString } from '../../../util/guards.js';
import { assertIndexAllowed, clampBucketSize, type AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { clampMinutesBack } from './common.js';

export async function topDestinationsForSource(
  ctx: { client: Client; fields: FieldPreference; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const index = typeof args.index === 'string' ? args.index : ctx.defaultIndex;
  assertIndexAllowed(index, ctx.policy);
  const srcIp = typeof args.srcIp === 'string' ? args.srcIp : '';
  if (!srcIp) throw new Error('srcIp is required');
  const minutesBack = clampMinutesBack(typeof args.minutesBack === 'number' ? args.minutesBack : 60, ctx.policy);
  const size = clampBucketSize(typeof args.size === 'number' ? args.size : 10, ctx.policy);

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } },
            { term: { [ctx.fields.srcIpField]: srcIp } },
          ],
        },
      },
      aggs: {
        by_dst: {
          terms: { field: ctx.fields.dstIpField, size },
          aggs: { bytes: { sum: { field: ctx.fields.bytesField } } },
        },
      },
    },
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_dst', 'buckets']).map((b) => {
    const bytes = getNumber(getNested(b, ['bytes', 'value']));
    return {
      dstIp: getString(b['key']),
      bytes,
      docCount: getNumber(b['doc_count']),
    };
  });
  return { srcIp, buckets };
}
