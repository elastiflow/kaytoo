import { externalDestinationIpBool } from '../../../opensearch/queries/destinationIp.js';
import type { SearchClient } from '../../../search/types.js';
import { getNumber, getString } from '../../../util/guards.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';
import { pickAggregatableField } from './pickAggregatableField.js';

export async function topExternalDestinationsByBytes(
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });

  const pick = (field: string | undefined) =>
    pickAggregatableField({ client: ctx.client, index, field });

  const [podNameAggField, nsAggField, displayNameAggField, dstPortAggField] = await Promise.all([
    pick(fields.podNameField),
    pick(fields.clientNamespaceField),
    pick(fields.srcDisplayNameField),
    pick(fields.dstPortField),
  ]);
  const displayAggField =
    displayNameAggField && displayNameAggField !== podNameAggField && displayNameAggField !== nsAggField
      ? displayNameAggField
      : undefined;
  const dstPortTermsField = dstPortAggField ?? fields.dstPortField;

  const bySrcLeafAggs: Record<string, unknown> = {
    sum_bytes: { sum: { field: fields.bytesField } },
    ...(podNameAggField ? { src_top_pods: { terms: { field: podNameAggField, size: 1 } } } : {}),
    ...(nsAggField ? { src_top_namespaces: { terms: { field: nsAggField, size: 1 } } } : {}),
    ...(displayAggField ? { src_top_display_names: { terms: { field: displayAggField, size: 1 } } } : {}),
  };

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
            top_ports: { terms: { field: dstPortTermsField, size: 3 } },
            ...(podNameAggField ? { top_src_pods: { terms: { field: podNameAggField, size: 3 } } } : {}),
            ...(nsAggField ? { top_src_namespaces: { terms: { field: nsAggField, size: 3 } } } : {}),
            by_src: {
              terms: {
                field: fields.srcIpField,
                size: clampBucketSize(5, ctx.policy),
                order: { sum_bytes: 'desc' },
              },
              aggs: bySrcLeafAggs,
            },
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
      topSources: getAggBuckets(b, ['by_src', 'buckets']).map((sb) => ({
        srcIp: getString(sb['key']),
        bytes: getNumber(getNested(sb, ['sum_bytes', 'value'])),
        flows: getNumber(sb['doc_count']),
        ...(podNameAggField
          ? {
              topPodNames: getAggBuckets(sb, ['src_top_pods', 'buckets']).map((pb) => ({
                podName: getString(pb['key']),
                docCount: getNumber(pb['doc_count']),
              })),
            }
          : {}),
        ...(nsAggField
          ? {
              topNamespaces: getAggBuckets(sb, ['src_top_namespaces', 'buckets']).map((nb) => ({
                namespace: getString(nb['key']),
                docCount: getNumber(nb['doc_count']),
              })),
            }
          : {}),
        ...(displayAggField
          ? {
              topSrcDisplayNames: getAggBuckets(sb, ['src_top_display_names', 'buckets']).map((db) => ({
                displayName: getString(db['key']),
                docCount: getNumber(db['doc_count']),
              })),
            }
          : {}),
      })),
    })),
  };
}
