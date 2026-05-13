import { getNumber, getString } from '../../../util/guards.js';
import type { SearchClient } from '../../../search/types.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';
import { pickAggregatableField } from './pickAggregatableField.js';

export async function topTalkersByBytes(
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 1440,
    defaultSize: 5,
  });
  const includeDistinctPods = args.includeDistinctPods === true;

  const pick = (field: string | undefined) =>
    pickAggregatableField({ client: ctx.client, index, field });
  const [podNameAggField, nsAggField, displayNameAggField] = await Promise.all([
    pick(fields.podNameField),
    pick(fields.clientNamespaceField),
    pick(fields.srcDisplayNameField),
  ]);
  const displayAggField =
    displayNameAggField && displayNameAggField !== podNameAggField && displayNameAggField !== nsAggField
      ? displayNameAggField
      : undefined;

  const bySrcAggs: Record<string, unknown> = {
    sum_bytes: { sum: { field: fields.bytesField } },
    ...(podNameAggField ? { top_pods: { terms: { field: podNameAggField, size: 3 } } } : {}),
    ...(podNameAggField && includeDistinctPods
      ? { distinct_pods: { cardinality: { field: podNameAggField, precision_threshold: 2000 } } }
      : {}),
    ...(nsAggField ? { top_namespaces: { terms: { field: nsAggField, size: 3 } } } : {}),
    ...(displayAggField ? { top_display_names: { terms: { field: displayAggField, size: 3 } } } : {}),
  };

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }],
        },
      },
      aggs: {
        by_src: {
          terms: {
            field: fields.srcIpField,
            size,
            order: { sum_bytes: 'desc' },
          },
          aggs: bySrcAggs,
        },
      },
    } as never,
  });

  const buckets = getAggBuckets(body, ['aggregations', 'by_src', 'buckets']);
  return {
    index,
    minutesBack,
    talkers: buckets.map((b) => ({
      srcIp: getString(b['key']),
      bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
      docCount: getNumber(b['doc_count']),
      ...(podNameAggField && includeDistinctPods
        ? { distinctPodNamesApprox: getNumber(getNested(b, ['distinct_pods', 'value'])) }
        : {}),
      ...(podNameAggField
        ? {
            topPodNames: getAggBuckets(b, ['top_pods', 'buckets']).map((pb) => ({
              podName: getString(pb['key']),
              docCount: getNumber(pb['doc_count']),
            })),
          }
        : {}),
      ...(nsAggField
        ? {
            topNamespaces: getAggBuckets(b, ['top_namespaces', 'buckets']).map((nb) => ({
              namespace: getString(nb['key']),
              docCount: getNumber(nb['doc_count']),
            })),
          }
        : {}),
      ...(displayAggField
        ? {
            topSrcDisplayNames: getAggBuckets(b, ['top_display_names', 'buckets']).map((db) => ({
              displayName: getString(db['key']),
              docCount: getNumber(db['doc_count']),
            })),
          }
        : {}),
    })),
  };
}
