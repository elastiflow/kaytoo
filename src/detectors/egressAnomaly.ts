import type { KaytooConfig } from '../config.js';
import type { EgressAggRow } from '../opensearch/queries/index.js';
import { buildEgressComparisonFrame, buildEgressVolumeSummary } from '../insights/egressInsightCopy.js';
import type { EgressInsightMode } from '../insights/egressInsightPolicy.js';
import { formatBytesHuman, formatEndpointLabel } from '../util/formatInsight.js';
import { egressDedupeKey, ipv6GlobalUnicastPrefix64 } from '../util/egressDedupeKey.js';
import type { Finding } from './types.js';

type CurrentAcc = {
  bytesByKey: Map<string, number>;
  maxRowByKey: Map<string, EgressAggRow>;
  srcIpsByKey: Map<string, Set<string>>;
};

function foldBaseline(rows: EgressAggRow[]): Map<string, number> {
  return rows.reduce((m, row) => {
    if (!row.srcIp) return m;
    const k = egressDedupeKey(row.srcIp);
    m.set(k, (m.get(k) ?? 0) + row.bytes);
    return m;
  }, new Map<string, number>());
}

function foldCurrent(rows: EgressAggRow[]): CurrentAcc {
  return rows.reduce(
    (acc, row) => {
      if (!row.srcIp) return acc;
      const k = egressDedupeKey(row.srcIp);
      acc.bytesByKey.set(k, (acc.bytesByKey.get(k) ?? 0) + row.bytes);
      const prev = acc.maxRowByKey.get(k);
      if (!prev || row.bytes > prev.bytes) acc.maxRowByKey.set(k, row);
      const ips = acc.srcIpsByKey.get(k);
      if (ips) ips.add(row.srcIp);
      else acc.srcIpsByKey.set(k, new Set([row.srcIp]));
      return acc;
    },
    {
      bytesByKey: new Map<string, number>(),
      maxRowByKey: new Map<string, EgressAggRow>(),
      srcIpsByKey: new Map<string, Set<string>>(),
    } satisfies CurrentAcc,
  );
}

function egressFindingForKey(opts: {
  mode: EgressInsightMode;
  key: string;
  totalBytes: number;
  sampleRow: EgressAggRow;
  srcIpsByKey: Map<string, Set<string>>;
  baselineByKey: Map<string, number>;
  expectedScale: number;
  thresholds: KaytooConfig['thresholds'];
  baselineMinutes: number;
  currentMinutes: number;
  window: { from: string; to: string };
}): Finding | null {
  const { mode, key, totalBytes, sampleRow, srcIpsByKey, baselineByKey, expectedScale, thresholds, baselineMinutes, currentMinutes, window } =
    opts;
  const baselineBytes = baselineByKey.get(key) ?? 0;
  const expectedBytes = baselineBytes * expectedScale;
  const threshold = Math.max(thresholds.egressMinBytes, expectedBytes * thresholds.egressMultiplier);
  if (totalBytes <= threshold) return null;

  const ratio = expectedBytes > 0 ? totalBytes / expectedBytes : Number.POSITIVE_INFINITY;
  const severity: Finding['severity'] =
    totalBytes > threshold * 5 ? 'high' : totalBytes > threshold * 2 ? 'medium' : 'low';

  const id = `${mode === 'spike' ? 'egress_spike' : 'egress'}:${key}`;
  const p64 = ipv6GlobalUnicastPrefix64(sampleRow.srcIp);
  const srcLabel = formatEndpointLabel({ displayName: sampleRow.srcDisplayName, ip: sampleRow.srcIp });
  const title = !p64
    ? `Unusual egress from ${srcLabel}`
    : sampleRow.srcDisplayName
      ? `Unusual egress from IPv6 /64 ${p64} (${srcLabel})`
      : `Unusual egress from IPv6 /64 ${p64}`;
  const vol = buildEgressVolumeSummary(totalBytes, expectedBytes, ratio);
  const summary = p64 ? `IPv6 /64 ${p64}: ${vol} top host ${srcLabel}.` : `${srcLabel}: ${vol}`;

  const contributingSrcIps = [...(srcIpsByKey.get(key) ?? new Set())].sort();

  return {
    id,
    kind: 'egress_anomaly' as const,
    severity,
    title,
    summary,
    evidence: {
      egressInsightMode: mode,
      egressKey: key,
      srcIp: sampleRow.srcIp,
      srcDisplayName: sampleRow.srcDisplayName,
      contributingSrcIps,
      bytes: totalBytes,
      bytesHuman: formatBytesHuman(totalBytes),
      expectedBytes,
      expectedBytesHuman: expectedBytes > 0 ? formatBytesHuman(expectedBytes) : undefined,
      volumeSummary: vol,
      comparisonFrame: buildEgressComparisonFrame(mode, currentMinutes, baselineMinutes),
      baselineBytes,
      baselineMinutes,
      currentMinutes,
      thresholds: {
        egressMultiplier: thresholds.egressMultiplier,
        egressMinBytes: thresholds.egressMinBytes,
      },
    },
    window,
  };
}

export function detectEgressAnomalies(opts: {
  mode?: EgressInsightMode;
  window: { from: string; to: string };
  current: EgressAggRow[];
  baseline: EgressAggRow[];
  thresholds: KaytooConfig['thresholds'];
  baselineMinutes: number;
  currentMinutes: number;
}): Finding[] {
  const mode = opts.mode ?? 'primary';
  const expectedScale = opts.currentMinutes / opts.baselineMinutes;
  const baselineByKey = foldBaseline(opts.baseline);
  const { bytesByKey, maxRowByKey, srcIpsByKey } = foldCurrent(opts.current);

  return [...bytesByKey.entries()].flatMap(([key, totalBytes]) => {
    const sampleRow = maxRowByKey.get(key);
    if (!sampleRow?.srcIp) return [];
    const f = egressFindingForKey({
      mode,
      key,
      totalBytes,
      sampleRow,
      srcIpsByKey,
      baselineByKey,
      expectedScale,
      thresholds: opts.thresholds,
      baselineMinutes: opts.baselineMinutes,
      currentMinutes: opts.currentMinutes,
      window: opts.window,
    });
    return f ? [f] : [];
  });
}
