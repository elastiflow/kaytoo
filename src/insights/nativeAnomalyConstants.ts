/** Stable Kaytoo-owned OpenSearch AD detector display name (search/list match). */
export const KAYTOO_OS_DETECTOR_NAME = 'Kaytoo flow egress by source';

/** Elasticsearch ML job + datafeed id prefix (single job). */
export const KAYTOO_ES_JOB_ID = 'kaytoo-flow-egress-by-src';

export const KAYTOO_ES_DATAFEED_ID = `${KAYTOO_ES_JOB_ID}-datafeed`;

/** Dedicated OS AD result index (must match OpenSearch 3.x prefix rule). */
export const KAYTOO_OS_RESULT_INDEX = 'opensearch-ad-plugin-result-kaytoo-flow-egress';

export const KAYTOO_OS_FEATURE_NAME = 'kaytoo_sum_bytes';

export function detectionIntervalMinutes(pollIntervalSeconds: number): number {
  const m = Math.max(5, Math.ceil(pollIntervalSeconds / 60));
  return Math.min(m, 60);
}
