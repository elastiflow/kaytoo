import type { Client } from '@opensearch-project/opensearch';
import { getNumber, getString } from '../../../util/guards.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

export async function crossNodeBytesByNode(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });

  const srcNode = fields.srcNodeField;
  const dstNode = fields.dstNodeField;
  if (!srcNode || !dstNode) {
    return { index, minutesBack, rows: [], note: 'Requires srcNodeField and dstNodeField.' };
  }

  const { body } = await ctx.client.search({
    index,
    size: 0,
    body: {
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } }] } },
      aggs: {
        by_src_node: {
          terms: { field: srcNode, size, order: { cross_bytes: 'desc' } },
          aggs: {
            cross_bytes: { sum: { field: fields.bytesField } },
          },
        },
      },
    } as never,
  });

  // NOTE: Without scripts/pipeline aggs, we can't strictly exclude same-node here. Return per-node totals and label accordingly.
  const buckets = getAggBuckets(body, ['aggregations', 'by_src_node', 'buckets']);
  return {
    index,
    minutesBack,
    srcNodeField: srcNode,
    dstNodeField: dstNode,
    note: 'Node fields exist; cross-node isolation may require pipeline aggs or precomputed cross-node flags.',
    rows: buckets.map((b) => ({
      srcNode: getString(b['key']),
      bytes: getNumber(getNested(b, ['cross_bytes', 'value'])),
      flows: getNumber(b['doc_count']),
    })),
  };
}

