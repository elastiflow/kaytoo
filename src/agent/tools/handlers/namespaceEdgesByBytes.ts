import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function namespaceEdgesByBytes(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 30,
    defaultSize: 15,
  });

  const srcNs = fields.clientNamespaceField;
  const dstNs = fields.dstNamespaceField;
  if (!srcNs || !dstNs) {
    return { index, minutesBack, edges: [], note: 'Requires source and destination namespace fields.' };
  }

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_src_ns: {
          terms: { field: srcNs, size, order: { sum_bytes: 'desc' } },
          aggs: {
            sum_bytes: { sum: { field: fields.bytesField } },
            by_dst_ns: {
              terms: { field: dstNs, size, order: { sum_bytes: 'desc' } },
              aggs: { sum_bytes: { sum: { field: fields.bytesField } } },
            },
          },
        },
      },
    } as never,
  });

  const rows: Array<{ srcNamespace: string; dstNamespace: string; bytes: number; flows: number }> = [];
  for (const sb of getAggBuckets(body, ['aggregations', 'by_src_ns', 'buckets'])) {
    const srcNamespace = getString(sb['key']);
    for (const db of getAggBuckets(sb, ['by_dst_ns', 'buckets'])) {
      const dstNamespace = getString(db['key']);
      if (srcNamespace && dstNamespace && srcNamespace === dstNamespace) continue;
      rows.push({
        srcNamespace,
        dstNamespace,
        bytes: getNumber(getNested(db, ['sum_bytes', 'value'])),
        flows: getNumber(db['doc_count']),
      });
    }
  }
  rows.sort((a, b) => b.bytes - a.bytes);

  return { index, minutesBack, edges: rows.slice(0, size) };
}

