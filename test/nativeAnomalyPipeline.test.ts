import { describe, expect, it, vi } from 'vitest';

const elasticMocks = vi.hoisted(() => ({
  createElasticsearchMlClient: vi.fn(),
  ensureElasticsearchMlAnomalyPipeline: vi.fn(),
}));

vi.mock('../src/opensearch/adLifecycle.js', () => ({
  ensureOpenSearchAnomalyPipeline: vi.fn().mockResolvedValue({
    ok: true,
    hasScopedSources: true,
    opensearch: { detectorIds: ['d'] },
  }),
}));

vi.mock('../src/elasticsearch/mlAnomalyLifecycle.js', () => elasticMocks);

describe('ensureNativeAnomalyPipeline', () => {
  it('delegates to OpenSearch lifecycle', async () => {
    const { ensureNativeAnomalyPipeline } = await import('../src/insights/nativeAnomalyPipeline.js');
    const { ensureOpenSearchAnomalyPipeline } = await import('../src/opensearch/adLifecycle.js');
    const r = await ensureNativeAnomalyPipeline({
      backend: 'opensearch',
      search: {} as never,
      searchClient: {} as never,
      indexPattern: 'x-*',
      fields: {
        bytesField: 'b',
        srcIpField: 's',
        dstIpField: 'd',
        srcPortField: '1',
        dstPortField: '2',
      } as import('../src/opensearch/fieldCaps.js').FieldPreference,
      pollIntervalSeconds: 60,
    });
    expect(ensureOpenSearchAnomalyPipeline).toHaveBeenCalled();
    expect(r.esMlClient).toBeNull();
    expect(r.pipeline.opensearch?.detectorIds).toEqual(['d']);
  });

  it('delegates to Elasticsearch ML lifecycle', async () => {
    elasticMocks.createElasticsearchMlClient.mockResolvedValue({ ml: {} } as never);
    elasticMocks.ensureElasticsearchMlAnomalyPipeline.mockResolvedValue({
      ok: true,
      hasScopedSources: true,
      elasticsearch: { jobIds: ['j1'] },
    });
    const { ensureNativeAnomalyPipeline } = await import('../src/insights/nativeAnomalyPipeline.js');
    const r = await ensureNativeAnomalyPipeline({
      backend: 'elasticsearch',
      search: { url: 'http://x', username: 'u', password: 'p', backend: 'elasticsearch', tlsInsecure: false, indexPattern: 'x' },
      searchClient: {} as never,
      indexPattern: 'flow-*',
      fields: {
        bytesField: 'b',
        srcIpField: 's',
        dstIpField: 'd',
        srcPortField: '1',
        dstPortField: '2',
      } as import('../src/opensearch/fieldCaps.js').FieldPreference,
      pollIntervalSeconds: 120,
    });
    expect(elasticMocks.createElasticsearchMlClient).toHaveBeenCalled();
    expect(elasticMocks.ensureElasticsearchMlAnomalyPipeline).toHaveBeenCalled();
    expect(r.pipeline.elasticsearch?.jobIds).toEqual(['j1']);
  });

  it('returns when Elasticsearch ML client cannot be created', async () => {
    elasticMocks.createElasticsearchMlClient.mockRejectedValueOnce(new Error('refused'));
    const { ensureNativeAnomalyPipeline } = await import('../src/insights/nativeAnomalyPipeline.js');
    const r = await ensureNativeAnomalyPipeline({
      backend: 'elasticsearch',
      search: { url: 'http://x', username: 'u', password: 'p', backend: 'elasticsearch', tlsInsecure: false, indexPattern: 'x' },
      searchClient: {} as never,
      indexPattern: 'flow-*',
      fields: {
        bytesField: 'b',
        srcIpField: 's',
        dstIpField: 'd',
        srcPortField: '1',
        dstPortField: '2',
      } as import('../src/opensearch/fieldCaps.js').FieldPreference,
      pollIntervalSeconds: 120,
    });
    expect(r.esMlClient).toBeNull();
    expect(r.pipeline.ok).toBe(false);
    expect(r.pipeline.warning).toMatch(/unavailable/i);
  });
});
