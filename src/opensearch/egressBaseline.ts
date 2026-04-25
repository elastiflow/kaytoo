import type { EgressAggRow } from './queries/index.js';

export type EgressVsBaselineRow = {
  srcIp: string;
  currentBytes: number;
  baselineBytes: number;
  expectedBytes: number;
  insightThresholdBytes: number;
  ratioVsExpected: number | null;
  passesInsightThreshold: boolean;
};

/** Egress vs baseline rows (insight-aligned scaling and thresholds). */
export function computeEgressVsBaselineRows(opts: {
  current: EgressAggRow[];
  baseline: EgressAggRow[];
  currentMinutes: number;
  baselineMinutes: number;
  egressMultiplier: number;
  egressMinBytes: number;
}): EgressVsBaselineRow[] {
  const baselineByIp = new Map(opts.baseline.map((row) => [row.srcIp, row.bytes] as const));
  const scale = opts.currentMinutes / opts.baselineMinutes;

  const rows = opts.current.map((row) => {
    const baselineBytes = baselineByIp.get(row.srcIp) ?? 0;
    const expectedBytes = baselineBytes * scale;
    const insightThresholdBytes = Math.max(opts.egressMinBytes, expectedBytes * opts.egressMultiplier);
    const ratioVsExpected = expectedBytes > 0 ? row.bytes / expectedBytes : null;
    return {
      srcIp: row.srcIp,
      currentBytes: row.bytes,
      baselineBytes,
      expectedBytes,
      insightThresholdBytes,
      ratioVsExpected,
      passesInsightThreshold: row.bytes > insightThresholdBytes,
    };
  });

  rows.sort((a, b) => b.currentBytes - a.currentBytes);
  return rows;
}
