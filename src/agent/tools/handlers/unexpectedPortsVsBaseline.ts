import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { clampMinutesBack, resolveAggToolContext } from './common.js';

export async function unexpectedPortsVsBaseline(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });
  const topWorkloads = clampBucketSize(typeof args.topWorkloads === 'number' ? args.topWorkloads : 8, ctx.policy);

  const workloadField = fields.podNameField ?? fields.srcIpField;
  const backgroundMinutesBack = clampMinutesBack(
    typeof args.backgroundMinutesBack === 'number' ? args.backgroundMinutesBack : 7 * 24 * 60,
    ctx.policy,
  );

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_workload: {
          terms: { field: workloadField, size: topWorkloads, order: { _count: 'desc' } },
          aggs: {
            unexpected_ports: {
              significant_terms: {
                field: fields.dstPortField,
                size: Math.min(10, size),
                background_filter: { range: { '@timestamp': { gte: `now-${backgroundMinutesBack}m`, lt: 'now' } } },
              },
              aggs: {
                sum_bytes: { sum: { field: fields.bytesField } },
              },
            },
          },
        },
      },
    } as never,
  });

  const out = getAggBuckets(body, ['aggregations', 'by_workload', 'buckets'])
    .map((wb) => {
      const workload = getString(wb['key']);
      const ports = getAggBuckets(wb, ['unexpected_ports', 'buckets']).map((pb) => ({
        port: getNumber(pb['key']),
        score: getNumber(pb['score']),
        docCount: getNumber(pb['doc_count']),
        bgCount: getNumber(pb['bg_count']),
        bytes: getNumber(getNested(pb, ['sum_bytes', 'value'])),
      }));
      return { workload, ports };
    })
    .filter((r) => r.workload && r.ports.length > 0)
    .slice(0, size);

  return {
    index,
    minutesBack,
    backgroundMinutesBack,
    workloadField,
    rows: out,
  };
}

