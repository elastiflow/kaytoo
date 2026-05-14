import type { SearchClient } from '../search/types.js';
import { getLogger, logErr } from '../logging/logger.js';
import { getString, isRecord } from '../util/guards.js';
import {
  KAYTOO_OS_DETECTOR_NAME,
  KAYTOO_OS_FEATURE_NAME,
  KAYTOO_OS_RESULT_INDEX,
  detectionIntervalMinutes,
} from '../insights/nativeAnomalyConstants.js';
import type { NativeAnomalyPipelineResult } from '../insights/nativeAnomalyTypes.js';

type TransportClient = SearchClient & {
  transport?: {
    request: (params: {
      method: string;
      path: string;
      body?: string | Record<string, unknown>;
    }) => Promise<{ body: unknown; statusCode: number | null }>;
  };
};

async function osTransport(
  client: SearchClient,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number | null; body: unknown }> {
  const t = (client as TransportClient).transport;
  if (!t?.request) throw new Error('OpenSearch client has no transport.request');
  const res = await t.request({
    method,
    path,
    ...(body ? { body } : {}),
  });
  return { statusCode: res.statusCode, body: res.body };
}

function indicesMatch(detectorIndices: unknown, indexPattern: string): boolean {
  if (!Array.isArray(detectorIndices) || detectorIndices.length === 0) return false;
  const bare = indexPattern.replace('*', '');
  return detectorIndices.some(
    (ix) =>
      typeof ix === 'string' &&
      (ix === indexPattern || indexPattern.includes(ix.replace('*', '')) || ix.includes(bare)),
  );
}

function categoryIncludes(det: Record<string, unknown>, srcIpField: string): boolean {
  const cf = det['category_field'];
  if (Array.isArray(cf)) return cf.some((x) => x === srcIpField);
  if (typeof cf === 'string') return cf === srcIpField;
  return false;
}

function featureSumsBytes(det: Record<string, unknown>, bytesField: string): boolean {
  // Heuristic: not a full aggregation AST; enough to match typical Kaytoo/vendor egress detectors.
  const attrs = det['feature_attributes'];
  if (!Array.isArray(attrs)) return false;
  for (const a of attrs) {
    if (!isRecord(a)) continue;
    const q = a['aggregation_query'];
    const s = JSON.stringify(q ?? {});
    if (s.includes('"sum"') && s.includes(bytesField)) return true;
  }
  return false;
}

export function detectorMatchesEgressShape(
  det: unknown,
  indexPattern: string,
  srcIpField: string,
  bytesField: string,
): boolean {
  if (!isRecord(det)) return false;
  if (getString(det['time_field']) !== '@timestamp') return false;
  if (!indicesMatch(det['indices'], indexPattern)) return false;
  if (!categoryIncludes(det, srcIpField)) return false;
  if (!featureSumsBytes(det, bytesField)) return false;
  return true;
}

function parseDetectorList(body: unknown): Array<{ id: string; raw: Record<string, unknown> }> {
  const out: Array<{ id: string; raw: Record<string, unknown> }> = [];
  if (!isRecord(body)) return out;

  const list = body['detectorList'];
  if (Array.isArray(list)) {
    for (const d of list) {
      if (!isRecord(d)) continue;
      const id = getString(d['id']) || getString(d['_id']);
      if (id) out.push({ id, raw: d });
    }
    if (out.length) return out;
  }

  const hits = body['hits'];
  if (isRecord(hits)) {
    const hh = hits['hits'];
    if (Array.isArray(hh)) {
      for (const h of hh) {
        if (!isRecord(h)) continue;
        const id = typeof h['_id'] === 'string' ? h['_id'] : getString(h['_id']);
        const src = isRecord(h['_source']) ? h['_source'] : h;
        if (id && isRecord(src)) out.push({ id, raw: src });
      }
    }
  }
  return out;
}

function kaytooNameRank(raw: Record<string, unknown>): number {
  return getString(raw['name']) === KAYTOO_OS_DETECTOR_NAME ? 0 : 1;
}

function pickEgressDetectors(
  detectors: Array<{ id: string; raw: Record<string, unknown> }>,
  indexPattern: string,
  srcIpField: string,
  bytesField: string,
  log: ReturnType<typeof getLogger>,
): string[] {
  const matches = detectors.filter((d) => detectorMatchesEgressShape(d.raw, indexPattern, srcIpField, bytesField));
  if (matches.length === 0) return [];
  const sorted = [...matches].sort(
    (a, b) => kaytooNameRank(a.raw) - kaytooNameRank(b.raw) || a.id.localeCompare(b.id),
  );
  const chosen = sorted[0]!;
  if (sorted.length > 1) {
    log.debug(
      { chosenDetectorId: chosen.id, otherMatchingDetectorIds: sorted.slice(1).map((d) => d.id) },
      'Multiple AD detectors matched egress shape; using deterministic tie-break.',
    );
  }
  return [chosen.id];
}

function buildCreateDetectorBody(opts: {
  indexPattern: string;
  srcIpField: string;
  bytesField: string;
  pollIntervalSeconds: number;
}): Record<string, unknown> {
  const interval = detectionIntervalMinutes(opts.pollIntervalSeconds);
  return {
    name: KAYTOO_OS_DETECTOR_NAME,
    description: 'Kaytoo-managed high-cardinality egress volume anomaly detector.',
    time_field: '@timestamp',
    indices: [opts.indexPattern],
    detector_type: 'MULTI_ENTITY',
    category_field: [opts.srcIpField],
    feature_attributes: [
      {
        feature_name: KAYTOO_OS_FEATURE_NAME,
        feature_enabled: true,
        aggregation_query: {
          [KAYTOO_OS_FEATURE_NAME]: { sum: { field: opts.bytesField } },
        },
      },
    ],
    detection_interval: { period: { interval, unit: 'Minutes' } },
    window_delay: { period: { interval: 1, unit: 'Minutes' } },
    result_index: KAYTOO_OS_RESULT_INDEX,
  };
}

type EgressDetectorEnsure = { ok: true; detectorIds: string[] } | { ok: false; result: NativeAnomalyPipelineResult };

async function egressDetectorIdsEnsure(
  opts: {
    client: SearchClient;
    indexPattern: string;
    srcIpField: string;
    bytesField: string;
    pollIntervalSeconds: number;
  },
  listed: Array<{ id: string; raw: Record<string, unknown> }>,
  log: ReturnType<typeof getLogger>,
): Promise<EgressDetectorEnsure> {
  const adopted = pickEgressDetectors(listed, opts.indexPattern, opts.srcIpField, opts.bytesField, log);
  if (adopted.length > 0) return { ok: true, detectorIds: adopted };

  const createRes = await osTransport(opts.client, 'POST', '/_plugins/_anomaly_detection/detectors', buildCreateDetectorBody(opts));
  if (createRes.statusCode && createRes.statusCode >= 400) {
    log.warn({ statusCode: createRes.statusCode, body: createRes.body }, 'OpenSearch AD create detector failed');
    return {
      ok: false,
      result: {
        ok: false,
        hasScopedSources: false,
        warning: 'Could not create Kaytoo OpenSearch anomaly detector (insufficient permissions or validation error).',
      },
    };
  }
  const created = isRecord(createRes.body) ? createRes.body : {};
  const newId = getString(created['_id']);
  if (newId) return { ok: true, detectorIds: [newId] };

  const relistBody = (
    await osTransport(opts.client, 'POST', '/_plugins/_anomaly_detection/detectors/_search', {
      query: { term: { name: KAYTOO_OS_DETECTOR_NAME } },
      size: 10,
    })
  ).body;
  const relist = parseDetectorList(relistBody);
  return {
    ok: true,
    detectorIds: pickEgressDetectors(relist, opts.indexPattern, opts.srcIpField, opts.bytesField, log),
  };
}

export async function ensureOpenSearchAnomalyPipeline(opts: {
  client: SearchClient;
  indexPattern: string;
  srcIpField: string;
  bytesField: string;
  pollIntervalSeconds: number;
}): Promise<NativeAnomalyPipelineResult> {
  const log = getLogger({ component: 'insights.nativeAnomaly' });
  try {
    const searchRes = await osTransport(opts.client, 'POST', '/_plugins/_anomaly_detection/detectors/_search', {
      query: { match_all: {} },
      size: 500,
    });
    if (searchRes.statusCode === 404) {
      return { ok: false, hasScopedSources: false, warning: 'OpenSearch Anomaly Detection plugin not available (404).' };
    }
    if (searchRes.statusCode && searchRes.statusCode >= 400) {
      return {
        ok: false,
        hasScopedSources: false,
        warning: `OpenSearch AD search failed (${searchRes.statusCode}).`,
      };
    }

    const listed = parseDetectorList(searchRes.body);
    const ensured = await egressDetectorIdsEnsure(opts, listed, log);
    if (!ensured.ok) return ensured.result;
    const { detectorIds } = ensured;

    if (detectorIds.length === 0) {
      return { ok: false, hasScopedSources: false, warning: 'OpenSearch AD: no detector id after ensure step.' };
    }

    for (const id of detectorIds) {
      const start = await osTransport(opts.client, 'POST', `/_plugins/_anomaly_detection/detectors/${encodeURIComponent(id)}/_start`);
      if (start.statusCode && start.statusCode >= 400) {
        log.debug({ detectorId: id, statusCode: start.statusCode, body: start.body }, 'OpenSearch AD start (may already be running)');
      }
    }

    return { ok: true, hasScopedSources: true, opensearch: { detectorIds } };
  } catch (e) {
    log.warn({ ...logErr(e) }, 'OpenSearch AD pipeline ensure failed');
    return { ok: false, hasScopedSources: false, warning: 'OpenSearch AD pipeline ensure threw.' };
  }
}
