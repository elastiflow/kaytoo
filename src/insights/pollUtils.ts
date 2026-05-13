import type { Finding } from '../detectors/types.js';
import type { DetectionFetchResult } from './opensearchDetections.js';

export function shouldSkipHeuristicPoll(alerting: DetectionFetchResult, ad: DetectionFetchResult): boolean {
  return alerting.healthyEmpty === true && ad.healthyEmpty === true;
}

export function findingSeverityRank(s: Finding['severity']): number {
  switch (s) {
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'low':
      return 2;
    case 'info':
      return 1;
  }
}

export type DedupeLike = { has(key: string): boolean };

export const INSIGHT_POST_MAX = 3;

export function insightSeverityEligibleForPost(s: Finding['severity']): boolean {
  return s === 'medium' || s === 'high';
}

/** Novel medium|high, dedupe keyed by finding id, severity order, max INSIGHT_POST_MAX. Primary vs spike egress use different ids so one host may appear twice. */
export function selectNovelInsightPostBatch(findings: Finding[], dedupe: DedupeLike): Finding[] {
  const novel = findings.filter((f) => !dedupe.has(f.id));
  return novel
    .filter((f) => insightSeverityEligibleForPost(f.severity))
    .sort(
      (a, b) =>
        findingSeverityRank(b.severity) - findingSeverityRank(a.severity) || a.id.localeCompare(b.id),
    )
    .slice(0, INSIGHT_POST_MAX);
}
