import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function topDestinationWorkloadsByBytes(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 10,
  });

  const orderBy = typeof args.orderBy === 'string' ? args.orderBy : 'bytes';
  const termsOrder =
    orderBy === 'flows' ? { _count: 'desc' } : { sum_bytes: 'desc' };

  const dstPodField = fields.dstPodNameField ?? fields.podNameField;
  const dstNsField = fields.dstNamespaceField ?? fields.clientNamespaceField;
  const dstSvcField = fields.dstServiceNameField;

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_dst: {
          terms: { field: fields.dstIpField, size, order: termsOrder },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(dstPodField ? { top_pods: { terms: { field: dstPodField, size: 3 } } } : {}),
            ...(dstNsField ? { top_namespaces: { terms: { field: dstNsField, size: 3 } } } : {}),
            ...(dstSvcField ? { top_services: { terms: { field: dstSvcField, size: 3 } } } : {}),
          },
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_dst', 'buckets']);
  return {
    index,
    minutesBack,
    orderBy,
    note:
      dstPodField || dstNsField || dstSvcField
        ? undefined
        : 'No destination workload fields mapped; returning destination IPs only.',
    destinations: buckets.map((b) => ({
      dstIp: getString(b['key']),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      flows: getNumber(b['doc_count']),
      topPodNames: getAggBuckets(b, ['top_pods', 'buckets']).map((pb) => ({
        podName: getString(pb['key']),
        flows: getNumber(pb['doc_count']),
      })),
      topNamespaces: getAggBuckets(b, ['top_namespaces', 'buckets']).map((nb) => ({
        namespace: getString(nb['key']),
        flows: getNumber(nb['doc_count']),
      })),
      topServices: getAggBuckets(b, ['top_services', 'buckets']).map((sb) => ({
        serviceName: getString(sb['key']),
        flows: getNumber(sb['doc_count']),
      })),
    })),
  };
}

