import type { KaytooConfig } from '../config.js';
import type { EgressAggRow } from '../opensearch/queries/index.js';
import type { Finding } from './types.js';

export function detectEgressAnomalies(opts: {
  window: { from: string; to: string };
  current: EgressAggRow[];
  baseline: EgressAggRow[];
  thresholds: KaytooConfig['thresholds'];
  baselineMinutes: number;
  currentMinutes: number;
}): Finding[] {
  const baselineByIp = new Map(opts.baseline.map((row) => [row.srcIp, row.bytes] as const));
  const expectedScale = opts.currentMinutes / opts.baselineMinutes;

  return opts.current.flatMap((row) => {
    if (!row.srcIp) return [];
    const baselineBytes = baselineByIp.get(row.srcIp) ?? 0;
    const expectedBytes = baselineBytes * expectedScale;
    const threshold = Math.max(opts.thresholds.egressMinBytes, expectedBytes * opts.thresholds.egressMultiplier);
    if (row.bytes <= threshold) return [];

    const ratio = expectedBytes > 0 ? row.bytes / expectedBytes : Number.POSITIVE_INFINITY;
    const severity: Finding['severity'] =
      row.bytes > threshold * 5 ? 'high' : row.bytes > threshold * 2 ? 'medium' : 'low';

    return [
      {
        // Stable across polls so DedupeStore suppresses repeat LLM posts for the same source IP.
        id: `egress:${row.srcIp}`,
        kind: 'egress_anomaly' as const,
        severity,
        title: `Unusual egress from ${row.srcIp}`,
        summary:
          expectedBytes > 0
            ? `${row.srcIp} transferred ${Math.round(row.bytes).toLocaleString()} bytes vs expected ~${Math.round(expectedBytes).toLocaleString()} bytes (${ratio.toFixed(1)}x).`
            : `${row.srcIp} transferred ${Math.round(row.bytes).toLocaleString()} bytes (no baseline for comparison).`,
        evidence: {
          srcIp: row.srcIp,
          bytes: row.bytes,
          expectedBytes,
          baselineBytes,
          baselineMinutes: opts.baselineMinutes,
          currentMinutes: opts.currentMinutes,
          thresholds: {
            egressMultiplier: opts.thresholds.egressMultiplier,
            egressMinBytes: opts.thresholds.egressMinBytes,
          },
        },
        window: opts.window,
      },
    ];
  });
}
