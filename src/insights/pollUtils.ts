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
