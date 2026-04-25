import type { Client } from '@opensearch-project/opensearch';
import { externalDestinationIpBool } from '../../../opensearch/queries/destinationIp.js';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function topExternalDestinationsByBytes(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });

  const srcPodField = fields.podNameField;
  const srcNsField = fields.clientNamespaceField;

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } },
            externalDestinationIpBool(fields.dstIpField),
          ],
        },
      },
      aggs: {
        by_dst: {
          terms: { field: fields.dstIpField, size, order: { sum_bytes: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(fields.dstPortField ? { top_ports: { terms: { field: fields.dstPortField, size: 3 } } } : {}),
            ...(srcPodField ? { top_src_pods: { terms: { field: srcPodField, size: 3 } } } : {}),
            ...(srcNsField ? { top_src_namespaces: { terms: { field: srcNsField, size: 3 } } } : {}),
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
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      flows: getNumber(b['doc_count']),
      topDstPorts: getAggBuckets(b, ['top_ports', 'buckets']).map((pb) => ({
        port: getNumber(pb['key']),
        flows: getNumber(pb['doc_count']),
      })),
      topSourcePods: getAggBuckets(b, ['top_src_pods', 'buckets']).map((sb) => ({
        podName: getString(sb['key']),
        flows: getNumber(sb['doc_count']),
      })),
      topSourceNamespaces: getAggBuckets(b, ['top_src_namespaces', 'buckets']).map((nb) => ({
        namespace: getString(nb['key']),
        flows: getNumber(nb['doc_count']),
      })),
    })),
  };
}

