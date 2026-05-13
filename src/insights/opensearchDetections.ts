import type { SearchClient } from '../search/types.js';
import type { Finding } from '../detectors/types.js';
import { getNumber, getString, isRecord } from '../util/guards.js';
import { getLogger } from '../logging/logger.js';
import { parseJsonOrNull } from '../util/json.js';

export type DetectionFetchResult = {
  ok: boolean;
  findings: Finding[];
  warning?: string;
  /** At least one index pattern search succeeded with zero hits (vs transport/query failure). */
  healthyEmpty?: boolean;
};

const ALERT_INDEX_PATTERNS = ['.opensearch-alerting-alerts*', '.opendistro-alerting-alerts*'];
const AD_RESULT_INDEX_PATTERNS = ['.opensearch-anomaly-results*', '.opendistro-anomaly-results*'];

const detectionsLog = getLogger({ component: 'insights.opensearchDetections' });

function shardsTotal(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const shards = (body as Record<string, unknown>)['_shards'];
  if (!shards || typeof shards !== 'object') return 0;
  return getNumber((shards as Record<string, unknown>)['total']);
}

export async function fetchOpenSearchAlertingFindings(opts: {
  client: SearchClient;
  now: Date;
  minutesBack: number;
}): Promise<DetectionFetchResult> {
  const query = {
    size: 20,
    query: {
      bool: {
        filter: [
          { range: { start_time: { gte: `now-${opts.minutesBack}m`, lt: 'now' } } },
        ],
      },
    },
    sort: [{ start_time: { order: 'desc' as const } }],
  };

  const scan = async (i: number, queried: boolean): Promise<DetectionFetchResult> => {
    if (i >= ALERT_INDEX_PATTERNS.length) {
      if (queried) return { ok: true, findings: [], healthyEmpty: true };
      return { ok: false, findings: [], warning: 'OpenSearch Alerting alerts not reachable or no alert indices found.' };
    }
    const index = ALERT_INDEX_PATTERNS[i]!;
    try {
      const { body } = (await opts.client.search({
        index,
        ignore_unavailable: true,
        allow_no_indices: true,
        expand_wildcards: 'all',
        body: query,
      })) as { body: unknown };
      if (shardsTotal(body) <= 0) return scan(i + 1, queried);

      const hits = getHits(body);
      if (hits.length === 0) return scan(i + 1, true);

      const findings = hits.map((h) => alertHitToFinding(h));
      return { ok: true, findings };
    } catch {
      return scan(i + 1, queried);
    }
  };

  return scan(0, false);
}

export async function fetchOpenSearchAdFindings(opts: {
  client: SearchClient;
  minutesBack: number;
}): Promise<DetectionFetchResult> {
  const query = {
    size: 20,
    query: {
      bool: {
        filter: [
          { range: { execution_end_time: { gte: `now-${opts.minutesBack}m`, lt: 'now' } } },
          { range: { anomaly_grade: { gt: 0 } } },
        ],
      },
    },
    sort: [{ anomaly_grade: { order: 'desc' as const } }, { confidence: { order: 'desc' as const } }],
  };

  const scan = async (i: number, queried: boolean): Promise<DetectionFetchResult> => {
    if (i >= AD_RESULT_INDEX_PATTERNS.length) {
      if (queried) return { ok: true, findings: [], healthyEmpty: true };
      return { ok: false, findings: [], warning: 'OpenSearch AD results not reachable or no AD result indices found.' };
    }
    const index = AD_RESULT_INDEX_PATTERNS[i]!;
    try {
      const { body } = (await opts.client.search({
        index,
        ignore_unavailable: true,
        allow_no_indices: true,
        expand_wildcards: 'all',
        body: query,
      })) as { body: unknown };
      if (shardsTotal(body) <= 0) return scan(i + 1, queried);

      const hits = getHits(body);
      if (hits.length === 0) return scan(i + 1, true);

      const findings = hits.map((h) => adHitToFinding(h));
      return { ok: true, findings };
    } catch {
      return scan(i + 1, queried);
    }
  };

  return scan(0, false);
}

type Hit = { _id?: unknown; _index?: unknown; _source?: unknown };

function getHits(body: unknown): Hit[] {
  const normalized: unknown =
    typeof body === 'string'
      ? parseJsonOrNull({ raw: body, context: 'opensearch.search.body_string', log: detectionsLog })
      : body;
  if (!normalized || typeof normalized !== 'object') return [];
  const hitsObj = (normalized as Record<string, unknown>)['hits'];
  if (!hitsObj || typeof hitsObj !== 'object') return [];
  const hits = (hitsObj as Record<string, unknown>)['hits'];
  if (!Array.isArray(hits)) return [];
  return hits.filter((h): h is Hit => !!h && typeof h === 'object');
}

function alertHitToFinding(hit: Hit): Finding {
  const src = isRecord(hit._source) ? hit._source : {};
  const id = typeof hit._id === 'string' ? hit._id : JSON.stringify({ i: hit._index, id: hit._id });
  const monitor = getString(src['monitor_name']) || getString(src['monitor_id']) || 'alert';
  const trigger = getString(src['trigger_name']) || 'trigger';
  const severity = 'medium' as const;

  return {
    id: `os-alert:${id}`,
    kind: 'opensearch_alert',
    severity,
    title: `OpenSearch alert: ${monitor}/${trigger}`,
    summary: getString(src['state']) ? `State: ${getString(src['state'])}` : 'OpenSearch Alerting fired.',
    evidence: { index: hit._index, id: hit._id, source: src },
    window: { from: new Date(0).toISOString(), to: new Date().toISOString() },
  };
}

function adHitToFinding(hit: Hit): Finding {
  const src = isRecord(hit._source) ? hit._source : {};
  const id = typeof hit._id === 'string' ? hit._id : JSON.stringify({ i: hit._index, id: hit._id });
  const grade = getNumber(src['anomaly_grade']);
  const confidence = getNumber(src['confidence']);
  const severity = grade >= 0.9 ? 'high' : grade >= 0.7 ? 'medium' : 'low';

  return {
    id: `os-ad:${id}`,
    kind: 'opensearch_anomaly',
    severity,
    title: `Anomaly detected (grade ${grade.toFixed(2)}, conf ${confidence.toFixed(2)})`,
    summary: 'OpenSearch Anomaly Detection reported an anomaly.',
    evidence: { index: hit._index, id: hit._id, source: src },
    window: { from: new Date(0).toISOString(), to: new Date().toISOString() },
  };
}

