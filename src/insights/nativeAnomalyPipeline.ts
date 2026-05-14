import type { KaytooConfig } from '../config.js';
import type { FieldPreference } from '../opensearch/fieldCaps.js';
import type { SearchClient } from '../search/types.js';
import { ensureOpenSearchAnomalyPipeline } from '../opensearch/adLifecycle.js';
import {
  createElasticsearchMlClient,
  ensureElasticsearchMlAnomalyPipeline,
  type ElasticsearchMlClient,
} from '../elasticsearch/mlAnomalyLifecycle.js';
import type { NativeAnomalyPipelineResult } from './nativeAnomalyTypes.js';

export async function ensureNativeAnomalyPipeline(opts: {
  backend: KaytooConfig['search']['backend'];
  search: KaytooConfig['search'];
  searchClient: SearchClient;
  indexPattern: string;
  fields: FieldPreference;
  pollIntervalSeconds: number;
}): Promise<{ pipeline: NativeAnomalyPipelineResult; esMlClient: ElasticsearchMlClient | null }> {
  if (opts.backend === 'opensearch') {
    const pipeline = await ensureOpenSearchAnomalyPipeline({
      client: opts.searchClient,
      indexPattern: opts.indexPattern,
      srcIpField: opts.fields.srcIpField,
      bytesField: opts.fields.bytesField,
      pollIntervalSeconds: opts.pollIntervalSeconds,
    });
    return { pipeline, esMlClient: null };
  }

  try {
    const esMlClient = await createElasticsearchMlClient(opts.search);
    const pipeline = await ensureElasticsearchMlAnomalyPipeline({
      client: esMlClient,
      indexPattern: opts.indexPattern,
      srcIpField: opts.fields.srcIpField,
      bytesField: opts.fields.bytesField,
      pollIntervalSeconds: opts.pollIntervalSeconds,
    });
    return { pipeline, esMlClient };
  } catch {
    return {
      pipeline: { ok: false, hasScopedSources: false, warning: 'Elasticsearch ML client unavailable.' },
      esMlClient: null,
    };
  }
}
