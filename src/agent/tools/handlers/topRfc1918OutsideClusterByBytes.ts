import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';
import { privateIpv4DstBool } from './internalRfc1918DstFilter.js';

function uniqStrings(xs: unknown): string[] {
  if (!Array.isArray(xs)) return [];
  const out: string[] = [];
  for (const v of xs) if (typeof v === 'string' && v.trim()) out.push(v.trim());
  return [...new Set(out)];
}

export async function topRfc1918OutsideClusterByBytes(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });

  const podCidrsArg = uniqStrings(args.podCidrs);
  const svcCidrsArg = uniqStrings(args.serviceCidrs);
  const podCidrs = podCidrsArg.length > 0 ? podCidrsArg : ['10.244.0.0/16'];
  const serviceCidrs = svcCidrsArg.length > 0 ? svcCidrsArg : ['10.96.0.0/12'];
  const excludeCidrs = [...podCidrs, ...serviceCidrs];

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
            privateIpv4DstBool(fields.dstIpField),
          ],
          must_not: excludeCidrs.map((cidr) => ({ term: { [fields.dstIpField]: cidr } })),
        },
      },
      aggs: {
        by_src: {
          terms: { field: fields.srcIpField, size, order: { sum_bytes: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            ...(srcPodField ? { top_pods: { terms: { field: srcPodField, size: 3 } } } : {}),
            ...(srcNsField ? { top_namespaces: { terms: { field: srcNsField, size: 3 } } } : {}),
            top_dst: {
              terms: { field: fields.dstIpField, size: 5, order: { sum_bytes: 'desc' } },
              aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
            },
          },
        },
      },
    } as never,
  });

  const rows = getAggBuckets(body, ['aggregations', 'by_src', 'buckets']).map((b) => ({
    srcIp: getString(b['key']),
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
    topDstIps: getAggBuckets(b, ['top_dst', 'buckets']).map((db) => ({
      dstIp: getString(db['key']),
      bytes: getNumber(getNested(db, ['sum_bytes', 'value'])),
      flows: getNumber(db['doc_count']),
    })),
  }));

  return {
    index,
    minutesBack,
    note:
      excludeCidrs.length > 0
        ? `Filtering RFC1918 dst IPs excluding cluster CIDRs: ${excludeCidrs.join(', ')}`
        : 'Filtering RFC1918 dst IPs (no cluster CIDR exclusions provided).',
    sources: rows,
  };
}

