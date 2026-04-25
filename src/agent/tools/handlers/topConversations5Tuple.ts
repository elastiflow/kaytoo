import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function topConversations5Tuple(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 15,
    defaultSize: 20,
  });

  const srcSize = Math.min(12, size);
  const dstSize = Math.min(12, size);
  const portSize = Math.min(6, size);
  const protoSize = Math.min(4, size);

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_src: {
          terms: { field: fields.srcIpField, size: srcSize, order: { sum_bytes: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            by_dst: {
              terms: { field: fields.dstIpField, size: dstSize, order: { sum_bytes: 'desc' } },
              aggs: {
                sum_bytes: { sum: { field: fields.bytesField } },
                by_sport: {
                  terms: { field: fields.srcPortField, size: portSize, order: { sum_bytes: 'desc' } },
                  aggs: {
                    sum_bytes: { sum: { field: fields.bytesField } },
                    by_dport: {
                      terms: { field: fields.dstPortField, size: portSize, order: { sum_bytes: 'desc' } },
                      aggs: {
                        sum_bytes: { sum: { field: fields.bytesField } },
                        ...(fields.packetsField ? { sum_packets: { sum: { field: fields.packetsField } } } : {}),
                        ...(fields.protoField
                          ? {
                              by_proto: {
                                terms: { field: fields.protoField, size: protoSize, order: { sum_bytes: 'desc' } },
                                aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
                              },
                            }
                          : {}),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as never,
  });

  const rows: Array<Record<string, unknown>> = [];
  for (const sb of getAggBuckets(body, ['aggregations', 'by_src', 'buckets'])) {
    const srcIp = getString(sb['key']);
    for (const db of getAggBuckets(sb, ['by_dst', 'buckets'])) {
      const dstIp = getString(db['key']);
      for (const spb of getAggBuckets(db, ['by_sport', 'buckets'])) {
        const srcPort = getNumber(spb['key']);
        for (const dpb of getAggBuckets(spb, ['by_dport', 'buckets'])) {
          const dstPort = getNumber(dpb['key']);
          const bytes = getNumber(getNested(dpb, ['sum_bytes', 'value']));
          const packets = fields.packetsField ? getNumber(getNested(dpb, ['sum_packets', 'value'])) : undefined;
          const flows = getNumber(dpb['doc_count']);
          if (fields.protoField) {
            const protos = getAggBuckets(dpb, ['by_proto', 'buckets']);
            if (protos.length > 0) {
              for (const pr of protos) {
                rows.push({
                  srcIp,
                  dstIp,
                  srcPort,
                  dstPort,
                  protocol: getString(pr['key']),
                  bytes: getNumber(getNested(pr, ['sum_bytes', 'value'])) || bytes,
                  ...(packets !== undefined ? { packets } : {}),
                  flows,
                });
              }
              continue;
            }
          }
          rows.push({
            srcIp,
            dstIp,
            srcPort,
            dstPort,
            bytes,
            ...(packets !== undefined ? { packets } : {}),
            flows,
          });
        }
      }
    }
  }
  rows.sort((a, b) => (Number(b['bytes']) || 0) - (Number(a['bytes']) || 0));

  return {
    index,
    minutesBack,
    conversations: rows.slice(0, size),
  };
}

