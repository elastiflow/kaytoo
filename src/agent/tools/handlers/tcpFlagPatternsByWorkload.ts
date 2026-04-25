import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function tcpFlagPatternsByWorkload(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 10,
  });

  const flags = fields.tcpFlagsField;
  if (!flags) return { index, minutesBack, rows: [], note: 'No tcp flags field mapped.' };

  const srcPodField = fields.podNameField;
  const srcNsField = fields.clientNamespaceField;

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_src: {
          terms: { field: fields.srcIpField, size, order: { _count: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(srcPodField ? { top_pods: { terms: { field: srcPodField, size: 1 } } } : {}),
            ...(srcNsField ? { top_namespaces: { terms: { field: srcNsField, size: 1 } } } : {}),
            top_flags: { terms: { field: flags, size: 5, order: { _count: 'desc' } } },
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_src', 'buckets']);
  return {
    index,
    minutesBack,
    tcpFlagsField: flags,
    rows: buckets.map((b) => ({
      srcIp: getString(b['key']),
      flows: getNumber(b['doc_count']),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      podName: getString(getNested(getAggBuckets(b, ['top_pods', 'buckets'])[0], ['key'])),
      namespace: getString(getNested(getAggBuckets(b, ['top_namespaces', 'buckets'])[0], ['key'])),
      topFlags: getAggBuckets(b, ['top_flags', 'buckets']).map((fb) => ({
        flags: getString(fb['key']),
        flows: getNumber(fb['doc_count']),
      })),
    })),
  };
}

