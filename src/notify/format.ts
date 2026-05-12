import type { Finding } from '../detectors/types.js';
import { INSIGHT_POST_MAX } from '../insights/pollUtils.js';

export function formatFindingsFallback(findings: Finding[]): string {
  if (findings.length === 0) return 'Kaytoo: no notable network-flow changes detected in the current window.';

  const top = findings.slice(0, INSIGHT_POST_MAX);
  const overflow =
    findings.length > top.length ? [`- ...and ${findings.length - top.length} more`] : [];
  const lines = [
    `Kaytoo: ${findings.length} insight(s)`,
    ...top.map((f) => `- [${f.severity}] ${f.title}: ${f.summary}`),
    ...overflow,
  ];
  return lines.join('\n');
}

