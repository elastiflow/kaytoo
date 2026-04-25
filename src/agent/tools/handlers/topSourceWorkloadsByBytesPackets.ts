import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function topSourceWorkloadsByBytesPackets(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 10,
  });
  const includePods = args.includePods !== false;

  const srcPodField = fields.podNameField;
  const srcNsField = fields.clientNamespaceField;

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_src: {
          terms: { field: fields.srcIpField, size, order: { sum_bytes: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(fields.packetsField ? { sum_packets: { sum: { field: fields.packetsField } } } : {}),
            ...(includePods && srcPodField ? { top_pods: { terms: { field: srcPodField, size: 2 } } } : {}),
            ...(srcNsField ? { top_namespaces: { terms: { field: srcNsField, size: 2 } } } : {}),
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_src', 'buckets']);
  return {
    index,
    minutesBack,
    rows: buckets.map((b) => ({
      srcIp: getString(b['key']),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      ...(fields.packetsField ? { packets: getNumber(getNested(b, ['sum_packets', 'value'])) } : {}),
      flows: getNumber(b['doc_count']),
      topPodNames: getAggBuckets(b, ['top_pods', 'buckets']).map((pb) => ({
        podName: getString(pb['key']),
        flows: getNumber(pb['doc_count']),
      })),
      topNamespaces: getAggBuckets(b, ['top_namespaces', 'buckets']).map((nb) => ({
        namespace: getString(nb['key']),
        flows: getNumber(nb['doc_count']),
      })),
    })),
  };
}

