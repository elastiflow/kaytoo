import type { RareDestAggRow } from '../opensearch/queries/index.js';
import type { Finding } from './types.js';

export function detectRareDestinations(opts: {
  window: { from: string; to: string };
  rows: RareDestAggRow[];
}): Finding[] {
  return opts.rows.map((row) => {
    const severity: Finding['severity'] = row.score >= 10 ? 'medium' : 'low';
    return {
      id: `raredest:${row.dstIp}`,
      kind: 'rare_destination' as const,
      severity,
      title: `Unusual destination spike: ${row.dstIp}`,
      summary: `${row.dstIp} is unusually prominent in recent flows (score ${row.score.toFixed(2)}; ${Math.round(
        row.bytes,
      ).toLocaleString()} bytes).`,
      evidence: {
        dstIp: row.dstIp,
        score: row.score,
        docCount: row.docCount,
        bytes: row.bytes,
      },
      window: opts.window,
    };
  });
}
