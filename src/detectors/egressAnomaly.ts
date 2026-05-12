import type { KaytooConfig } from '../config.js';
import type { EgressAggRow } from '../opensearch/queries/index.js';
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
  const { key, totalBytes, sampleRow, srcIpsByKey, baselineByKey, expectedScale, thresholds, baselineMinutes, currentMinutes, window } = opts;
  const baselineBytes = baselineByKey.get(key) ?? 0;
  const expectedBytes = baselineBytes * expectedScale;
  const threshold = Math.max(thresholds.egressMinBytes, expectedBytes * thresholds.egressMultiplier);
  if (totalBytes <= threshold) return null;

  const ratio = expectedBytes > 0 ? totalBytes / expectedBytes : Number.POSITIVE_INFINITY;
  const severity: Finding['severity'] =
    totalBytes > threshold * 5 ? 'high' : totalBytes > threshold * 2 ? 'medium' : 'low';

  const id = `egress:${key}`;
  const p64 = ipv6GlobalUnicastPrefix64(sampleRow.srcIp);
  const title = p64 ? `Unusual egress from IPv6 /64 ${p64}` : `Unusual egress from ${sampleRow.srcIp}`;
  const summary =
    expectedBytes > 0
      ? p64
        ? `IPv6 /64 ${p64}: ${totalBytes.toLocaleString()} bytes vs expected ~${Math.round(expectedBytes).toLocaleString()} (${ratio.toFixed(1)}x); top host ${sampleRow.srcIp}.`
        : `${sampleRow.srcIp} transferred ${Math.round(totalBytes).toLocaleString()} bytes vs expected ~${Math.round(expectedBytes).toLocaleString()} bytes (${ratio.toFixed(1)}x).`
      : p64
        ? `IPv6 /64 ${p64}: ${totalBytes.toLocaleString()} bytes (no baseline for comparison); top host ${sampleRow.srcIp}.`
        : `${sampleRow.srcIp} transferred ${Math.round(totalBytes).toLocaleString()} bytes (no baseline for comparison).`;

  const contributingSrcIps = [...(srcIpsByKey.get(key) ?? new Set())].sort();

  return {
    id,
    kind: 'egress_anomaly' as const,
    severity,
    title,
    summary,
    evidence: {
      egressKey: key,
      srcIp: sampleRow.srcIp,
      contributingSrcIps,
      bytes: totalBytes,
      expectedBytes,
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
  window: { from: string; to: string };
  current: EgressAggRow[];
  baseline: EgressAggRow[];
  thresholds: KaytooConfig['thresholds'];
  baselineMinutes: number;
  currentMinutes: number;
}): Finding[] {
  const expectedScale = opts.currentMinutes / opts.baselineMinutes;
  const baselineByKey = foldBaseline(opts.baseline);
  const { bytesByKey, maxRowByKey, srcIpsByKey } = foldCurrent(opts.current);

  return [...bytesByKey.entries()].flatMap(([key, totalBytes]) => {
    const sampleRow = maxRowByKey.get(key);
    if (!sampleRow?.srcIp) return [];
    const f = egressFindingForKey({
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
