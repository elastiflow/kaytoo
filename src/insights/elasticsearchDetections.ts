import type { Finding } from '../detectors/types.js';
import type { ElasticsearchMlClient } from '../elasticsearch/mlAnomalyLifecycle.js';
import type { DetectionFetchResult } from './opensearchDetections.js';
import { getNumber, getString, isRecord } from '../util/guards.js';

function mlRecordTimestampIso(rec: Record<string, unknown>): string {
  const v = rec['timestamp'];
  if (typeof v === 'number' && Number.isFinite(v)) {
    // ML APIs normally return epoch ms; values below ~1e12 are treated as seconds.
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  const s = getString(v);
  if (!s) return '';
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? s : new Date(ms).toISOString();
}

function recordToFinding(jobId: string, rec: Record<string, unknown>): Finding {
  const score = Math.max(getNumber(rec['record_score']), getNumber(rec['initial_record_score']));
  const severity = score >= 90 ? 'high' : score >= 50 ? 'medium' : 'low';
  const over = getString(rec['over_field_value']);
  const t = mlRecordTimestampIso(rec) || new Date(0).toISOString();
  const id = `es-ml:${jobId}:${t}:${over}:${score.toFixed(2)}`;
  const evidence: Record<string, unknown> = { jobId, source: rec };
  if (over) evidence['contributingSrcIps'] = [over];
  return {
    id,
    kind: 'elasticsearch_ml_anomaly',
    severity,
    title: over ? `ML anomaly: ${over} (score ${score.toFixed(1)})` : `ML anomaly (score ${score.toFixed(1)})`,
    summary: 'Elasticsearch machine learning reported an anomalous record.',
    evidence,
    window: { from: t, to: t },
  };
}

export async function fetchElasticsearchMlAnomalyFindings(opts: {
  client: ElasticsearchMlClient;
  jobIds: string[];
  now: Date;
  minutesBack: number;
}): Promise<DetectionFetchResult> {
  if (opts.jobIds.length === 0) return { ok: true, findings: [], healthyEmpty: false };

  const findings: Finding[] = [];
  const to = opts.now.getTime();
  const fromMs = to - opts.minutesBack * 60_000;
  const start = new Date(fromMs).toISOString();
  const end = new Date(to).toISOString();

  try {
    for (const jobId of opts.jobIds) {
      const res = await opts.client.ml.getRecords({
        job_id: jobId,
        start,
        end,
        desc: true,
        size: 20,
      } as never);
      const recs = isRecord(res) && Array.isArray(res['records']) ? res['records'] : [];
      for (const r of recs) {
        if (!isRecord(r)) continue;
        const score = Math.max(getNumber(r['record_score']), getNumber(r['initial_record_score']));
        if (score <= 0) continue;
        findings.push(recordToFinding(jobId, r));
      }
    }
    return { ok: true, findings, healthyEmpty: findings.length === 0 };
  } catch (e) {
    return { ok: false, findings: [], warning: `Elasticsearch ML getRecords failed: ${String(e)}` };
  }
}
