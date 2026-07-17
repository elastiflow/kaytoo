import type { KaytooConfig } from '../config.js';
import type { SearchClient } from '../search/types.js';
import type { ElasticsearchMlClient } from '../elasticsearch/mlAnomalyLifecycle.js';
import type { NativeAnomalyPipelineResult } from './nativeAnomalyTypes.js';
import {
  fetchOpenSearchAdFindings,
  fetchOpenSearchAlertingFindings,
  type DetectionFetchResult,
} from './opensearchDetections.js';
import { fetchElasticsearchMlAnomalyFindings } from './elasticsearchDetections.js';

export async function fetchNativeAlertFindings(opts: {
  backend: KaytooConfig['search']['backend'];
  client: SearchClient;
  now: Date;
  minutesBack: number;
}): Promise<DetectionFetchResult> {
  if (opts.backend !== 'opensearch') {
    return { ok: true, findings: [], healthyEmpty: false };
  }
  return fetchOpenSearchAlertingFindings({
    client: opts.client,
    now: opts.now,
    minutesBack: opts.minutesBack,
  });
}

export async function fetchNativeAnomalyFindings(opts: {
  backend: KaytooConfig['search']['backend'];
  searchClient: SearchClient;
  esMlClient: ElasticsearchMlClient | null;
  pipeline: NativeAnomalyPipelineResult;
  now: Date;
  minutesBack: number;
}): Promise<DetectionFetchResult> {
  if (opts.backend === 'opensearch') {
    return fetchOpenSearchAdFindings({
      client: opts.searchClient,
      minutesBack: opts.minutesBack,
      detectorIds: opts.pipeline.opensearch?.detectorIds ?? [],
    });
  }
  if (opts.backend === 'elasticsearch' && opts.esMlClient && opts.pipeline.elasticsearch?.jobIds?.length) {
    return fetchElasticsearchMlAnomalyFindings({
      client: opts.esMlClient,
      jobIds: opts.pipeline.elasticsearch.jobIds,
      now: opts.now,
      minutesBack: opts.minutesBack,
    });
  }
  return { ok: true, findings: [], healthyEmpty: false };
}
