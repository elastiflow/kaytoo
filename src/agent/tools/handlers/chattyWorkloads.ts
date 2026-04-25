import { getNumber, getString } from '../../../util/guards.js';
import type { SearchClient } from '../../../search/types.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function chattyWorkloads(
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 15,
  });
  const maxAvg = typeof args.maxAvgBytesPerFlow === 'number' && Number.isFinite(args.maxAvgBytesPerFlow) ? args.maxAvgBytesPerFlow : 500;

  const srcPodField = fields.podNameField;
  const srcNsField = fields.clientNamespaceField;

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_src: {
          terms: { field: fields.srcIpField, size: Math.min(80, ctx.policy.maxBucketSize), order: { _count: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(srcPodField ? { top_pods: { terms: { field: srcPodField, size: 2 } } } : {}),
            ...(srcNsField ? { top_namespaces: { terms: { field: srcNsField, size: 2 } } } : {}),
            top_dsts: { terms: { field: fields.dstIpField, size: 3, order: { sum_bytes: 'desc' } }, aggs: { sum_bytes: { sum: { field: fields.bytesField } } } },
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_src', 'buckets']);
  const rows = buckets
    .map((b) => {
      const flows = getNumber(b['doc_count']);
      const bytes = getNumber(getNested(b, ['sum_bytes', 'value']));
      const avg = flows > 0 ? bytes / flows : 0;
      return {
        srcIp: getString(b['key']),
        flows,
        bytes,
        avgBytesPerFlow: avg,
        topPodNames: getAggBuckets(b, ['top_pods', 'buckets']).map((pb) => ({ podName: getString(pb['key']), flows: getNumber(pb['doc_count']) })),
        topNamespaces: getAggBuckets(b, ['top_namespaces', 'buckets']).map((nb) => ({ namespace: getString(nb['key']), flows: getNumber(nb['doc_count']) })),
        topDestinations: getAggBuckets(b, ['top_dsts', 'buckets']).map((db) => ({
          dstIp: getString(db['key']),
          bytes: getNumber(getNested(db, ['sum_bytes', 'value'])),
          flows: getNumber(db['doc_count']),
        })),
      };
    })
    .filter((r) => r.avgBytesPerFlow > 0 && r.avgBytesPerFlow <= maxAvg)
    .slice(0, size);

  return { index, minutesBack, maxAvgBytesPerFlow: maxAvg, rows };
}

