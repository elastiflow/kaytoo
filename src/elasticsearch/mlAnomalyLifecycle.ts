import type { KaytooConfig } from '../config.js';
import { getLogger, logErr } from '../logging/logger.js';
import { getString, isRecord } from '../util/guards.js';
import {
  KAYTOO_ES_DATAFEED_ID,
  KAYTOO_ES_JOB_ID,
  detectionIntervalMinutes,
} from '../insights/nativeAnomalyConstants.js';
import type { NativeAnomalyPipelineResult } from '../insights/nativeAnomalyTypes.js';

export type ElasticsearchMlClient = import('@elastic/elasticsearch').Client;

export async function createElasticsearchMlClient(config: KaytooConfig['search']): Promise<ElasticsearchMlClient> {
  const { Client } = await import('@elastic/elasticsearch');
  return new Client({
    node: config.url,
    auth: { username: config.username, password: config.password },
    ...(config.tlsInsecure ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

function bucketSpan(pollIntervalSeconds: number): string {
  return `${detectionIntervalMinutes(pollIntervalSeconds)}m`;
}

export function mlJobMatchesEgressShape(job: unknown, indexPattern: string, srcIpField: string, bytesField: string): boolean {
  if (!isRecord(job)) return false;
  const dc = job['data_description'];
  if (!isRecord(dc) || getString(dc['time_field']) !== '@timestamp') return false;
  const ac = job['analysis_config'];
  if (!isRecord(ac)) return false;
  const dets = ac['detectors'];
  if (!Array.isArray(dets)) return false;
  const ok = dets.some((d) => {
    if (!isRecord(d)) return false;
    return (
      getString(d['function']) === 'sum' &&
      getString(d['field_name']) === bytesField &&
      getString(d['over_field_name']) === srcIpField
    );
  });
  if (!ok) return false;
  const dfs = job['datafeed_config'];
  if (!isRecord(dfs)) return true;
  const ix = dfs['indices'];
  if (!Array.isArray(ix) || ix.length === 0) return true;
  return ix.some(
    (i) =>
      typeof i === 'string' &&
      (i === indexPattern || indexPattern.startsWith(i.replace('*', '')) || i.startsWith(indexPattern.replace('*', ''))),
  );
}

async function startDatafeedsForJob(client: ElasticsearchMlClient, jobId: string, log: ReturnType<typeof getLogger>): Promise<void> {
  try {
    const res = await client.ml.getDatafeeds({ job_id: jobId } as never);
    const feeds = isRecord(res) && Array.isArray(res['datafeeds']) ? res['datafeeds'] : [];
    for (const f of feeds) {
      if (!isRecord(f)) continue;
      const id = getString(f['datafeed_id']);
      if (id) await client.ml.startDatafeed({ datafeed_id: id }).catch((e) => log.debug({ datafeedId: id, err: String(e) }, 'ml startDatafeed noop'));
    }
  } catch (e) {
    log.debug({ ...logErr(e) }, 'ml getDatafeeds for job');
  }
}

function pickMatchingJobIds(jobs: unknown[], indexPattern: string, srcIpField: string, bytesField: string): string[] {
  const matches: { id: string; kaytoo: number }[] = [];
  for (const j of jobs) {
    if (!isRecord(j)) continue;
    const id = getString(j['job_id']);
    if (!id || !mlJobMatchesEgressShape(j, indexPattern, srcIpField, bytesField)) continue;
    matches.push({ id, kaytoo: id === KAYTOO_ES_JOB_ID ? 0 : 1 });
  }
  matches.sort((a, b) => a.kaytoo - b.kaytoo || a.id.localeCompare(b.id));
  return matches.length ? [matches[0]!.id] : [];
}

function resourceAlreadyExists(e: unknown): boolean {
  return String(e).includes('resource_already_exists_exception');
}

export async function ensureElasticsearchMlAnomalyPipeline(opts: {
  client: ElasticsearchMlClient;
  indexPattern: string;
  srcIpField: string;
  bytesField: string;
  pollIntervalSeconds: number;
}): Promise<NativeAnomalyPipelineResult> {
  const log = getLogger({ component: 'insights.nativeAnomaly' });
  try {
    const list = await opts.client.ml.getJobs({});
    const jobs = isRecord(list) && Array.isArray(list['jobs']) ? list['jobs'] : [];
    let jobIds = pickMatchingJobIds(jobs, opts.indexPattern, opts.srcIpField, opts.bytesField);

    if (jobIds.length === 0) {
      const span = bucketSpan(opts.pollIntervalSeconds);
      try {
        await opts.client.ml.putJob({
          job_id: KAYTOO_ES_JOB_ID,
          description: 'Kaytoo-managed flow egress — sum bytes by source IP.',
          analysis_config: {
            bucket_span: span,
            detectors: [{ function: 'sum', field_name: opts.bytesField, over_field_name: opts.srcIpField }],
          },
          data_description: { time_field: '@timestamp' },
        } as never);
      } catch (e) {
        if (!resourceAlreadyExists(e)) {
          log.warn({ ...logErr(e) }, 'Elasticsearch ML putJob failed');
          return {
            ok: false,
            hasScopedSources: false,
            warning: 'Could not create Kaytoo Elasticsearch ML job (ML unavailable or insufficient permissions).',
          };
        }
      }

      try {
        await opts.client.ml.putDatafeed({
          datafeed_id: KAYTOO_ES_DATAFEED_ID,
          job_id: KAYTOO_ES_JOB_ID,
          indices: [opts.indexPattern],
          query: { match_all: {} },
          scroll_size: 1000,
        } as never);
      } catch (e) {
        if (!resourceAlreadyExists(e)) {
          log.warn({ ...logErr(e) }, 'Elasticsearch ML putDatafeed failed');
          return { ok: false, hasScopedSources: false, warning: 'Could not create Kaytoo ML datafeed.' };
        }
      }

      jobIds = [KAYTOO_ES_JOB_ID];
    }

    for (const jid of jobIds) {
      try {
        await opts.client.ml.openJob({ job_id: jid });
      } catch {
        // already open
      }
      await startDatafeedsForJob(opts.client, jid, log);
    }

    return { ok: true, hasScopedSources: jobIds.length > 0, elasticsearch: { jobIds } };
  } catch (e) {
    log.warn({ ...logErr(e) }, 'Elasticsearch ML pipeline ensure failed');
    return { ok: false, hasScopedSources: false, warning: 'Elasticsearch ML pipeline ensure threw.' };
  }
}
