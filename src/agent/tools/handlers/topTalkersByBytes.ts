import { getNumber, getString } from '../../../util/guards.js';
import type { SearchClient } from '../../../search/types.js';
import type { AgentPolicy } from '../../policy.js';
import { getAggBuckets, getNested } from '../helpers.js';
import { resolveAggToolContext } from './common.js';

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

  const pickAggField = async (field: string | undefined): Promise<string | undefined> => {
    if (!field) return undefined;
    const keyword = `${field}.keyword`;
    const resp = await ctx.client.fieldCaps({
      index,
      fields: [field, keyword],
      ignore_unavailable: true,
      allow_no_indices: true,
    });
    const caps = (resp.body as { fields?: Record<string, unknown> }).fields ?? {};

    const isAggregatable = (f: string): boolean => {
      const entry = caps[f];
      if (!entry || typeof entry !== 'object') return false;
      return Object.values(entry as Record<string, unknown>).some((t) => {
        if (!t || typeof t !== 'object') return false;
        return (t as { aggregatable?: unknown }).aggregatable === true;
      });
    };

    if (isAggregatable(field)) return field;
    if (isAggregatable(keyword)) return keyword;
    return undefined;
  };

  const [podNameAggField, nsAggField, displayNameAggField] = await Promise.all([
    pickAggField(fields.podNameField),
    pickAggField(fields.clientNamespaceField),
    pickAggField(fields.srcDisplayNameField),
  ]);

  const bySrcAggs: Record<string, unknown> = {
    sum_bytes: { sum: { field: fields.bytesField } },
  };
  if (podNameAggField) {
    bySrcAggs.top_pods = { terms: { field: podNameAggField, size: 3 } };
    if (includeDistinctPods) {
      bySrcAggs.distinct_pods = { cardinality: { field: podNameAggField, precision_threshold: 2000 } };
    }
  }
  if (nsAggField) {
    bySrcAggs.top_namespaces = { terms: { field: nsAggField, size: 3 } };
  }
  if (displayNameAggField && displayNameAggField !== podNameAggField) {
    bySrcAggs.top_display_names = { terms: { field: displayNameAggField, size: 3 } };
  }

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
    talkers: buckets.map((b) => {
      const row: Record<string, unknown> = {
        srcIp: getString(b['key']),
        bytes: getNumber(getNested(b, ['sum_bytes', 'value'])),
        docCount: getNumber(b['doc_count']),
      };
      if (podNameAggField && includeDistinctPods) {
        row.distinctPodNamesApprox = getNumber(getNested(b, ['distinct_pods', 'value']));
      }
      if (podNameAggField) {
        row.topPodNames = getAggBuckets(b, ['top_pods', 'buckets']).map((pb) => ({
          podName: getString(pb['key']),
          docCount: getNumber(pb['doc_count']),
        }));
      }
      if (nsAggField) {
        row.topNamespaces = getAggBuckets(b, ['top_namespaces', 'buckets']).map((nb) => ({
          namespace: getString(nb['key']),
          docCount: getNumber(nb['doc_count']),
        }));
      }
      if (displayNameAggField && displayNameAggField !== podNameAggField) {
        row.topSrcDisplayNames = getAggBuckets(b, ['top_display_names', 'buckets']).map((db) => ({
          displayName: getString(db['key']),
          docCount: getNumber(db['doc_count']),
        }));
      }
      return row;
    }),
  };
}
