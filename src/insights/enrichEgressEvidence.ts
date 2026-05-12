import type { Logger } from 'pino';
import type { Finding } from '../detectors/types.js';
import type { FieldPreference } from '../opensearch/fieldCaps.js';
import { getBuckets, timedSearch, toNumber, toString, type AggValue } from '../opensearch/queries/shared.js';
import type { SearchClient } from '../search/types.js';
import { logErr } from '../logging/logger.js';

const MAX_SRC_TERMS = 16;
const TOP_DST = 8;
const TOP_PORT = 8;
const TOP_NS = 4;
const TOP_POD = 4;

export async function enrichEgressFinding(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  finding: Finding;
}): Promise<Finding> {
  const { finding, client, index, fields } = opts;
  if (finding.kind !== 'egress_anomaly') return finding;
  const raw = finding.evidence['contributingSrcIps'];
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return finding;
  const srcIpList = raw.slice(0, MAX_SRC_TERMS);
  if (srcIpList.length === 0) return finding;

  const aggs: Record<string, unknown> = {
    by_dst: {
      terms: { field: fields.dstIpField, size: TOP_DST, order: { dst_bytes: 'desc' } },
      aggs: { dst_bytes: { sum: { field: fields.bytesField } } },
    },
    by_dport: {
      terms: { field: fields.dstPortField, size: TOP_PORT, order: { pbytes: 'desc' } },
      aggs: { pbytes: { sum: { field: fields.bytesField } } },
    },
  };
  if (fields.clientNamespaceField) {
    aggs.by_client_ns = {
      terms: { field: fields.clientNamespaceField, size: TOP_NS, order: { nb: 'desc' } },
      aggs: { nb: { sum: { field: fields.bytesField } } },
    };
  }
  if (fields.podNameField) {
    aggs.by_client_pod = {
      terms: { field: fields.podNameField, size: TOP_POD, order: { pb: 'desc' } },
      aggs: { pb: { sum: { field: fields.bytesField } } },
    };
  }

  const res = await timedSearch('insightEnrichEgress', client, {
    index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: finding.window.from, lt: finding.window.to } } },
            {
              bool: {
                should: srcIpList.map((ip) => ({ term: { [fields.srcIpField]: ip } })),
                minimum_should_match: 1,
              },
            },
          ],
        },
      },
      aggs,
    } as never,
  });

  const body = (res as { body?: unknown })?.body;
  const topDestinations = getBuckets(body as unknown, ['aggregations', 'by_dst', 'buckets']).map((b) => {
    const bytes = toNumber((b['dst_bytes'] as AggValue | undefined)?.value);
    return { dstIp: toString(b['key']), bytes, flows: toNumber(b['doc_count']) };
  });
  const topDstPorts = getBuckets(body as unknown, ['aggregations', 'by_dport', 'buckets']).map((b) => {
    const bytes = toNumber((b['pbytes'] as AggValue | undefined)?.value);
    const k = b['key'];
    const port = typeof k === 'number' && Number.isFinite(k) ? k : Number.parseInt(String(k), 10) || 0;
    return { port, bytes, flows: toNumber(b['doc_count']) };
  });

  const topClientNamespaces = fields.clientNamespaceField
    ? getBuckets(body as unknown, ['aggregations', 'by_client_ns', 'buckets']).map((b) => ({
        namespace: toString(b['key']),
        bytes: toNumber((b['nb'] as AggValue | undefined)?.value),
        flows: toNumber(b['doc_count']),
      }))
    : undefined;
  const topClientPods = fields.podNameField
    ? getBuckets(body as unknown, ['aggregations', 'by_client_pod', 'buckets']).map((b) => ({
        podName: toString(b['key']),
        bytes: toNumber((b['pb'] as AggValue | undefined)?.value),
        flows: toNumber(b['doc_count']),
      }))
    : undefined;

  return {
    ...finding,
    evidence: {
      ...finding.evidence,
      topDestinations,
      topDstPorts,
      ...(topClientNamespaces?.length ? { topClientNamespaces } : {}),
      ...(topClientPods?.length ? { topClientPods } : {}),
    },
  };
}

export async function enrichInsightsEgressBatch(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  findings: Finding[];
  log: Logger;
}): Promise<Finding[]> {
  return Promise.all(
    opts.findings.map(async (f) => {
      if (f.kind !== 'egress_anomaly') return f;
      try {
        return await enrichEgressFinding({
          client: opts.client,
          index: opts.index,
          fields: opts.fields,
          finding: f,
        });
      } catch (e) {
        opts.log.warn({ ...logErr(e), findingId: f.id }, 'egress insight enrichment failed');
        return f;
      }
    }),
  );
}
