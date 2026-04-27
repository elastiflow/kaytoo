import { beforeEach, describe, expect, it, vi } from 'vitest';

const elasticCtor = vi.fn();
const osCtor = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: elasticCtor,
}));

vi.mock('@opensearch-project/opensearch', () => ({
  Client: osCtor,
}));

describe('createSearchClient', () => {
  beforeEach(() => {
    vi.resetModules();
    elasticCtor.mockReset();
    osCtor.mockReset();
  });

  it('constructs Elasticsearch client with optional TLS insecure', async () => {
    const innerSearch = vi.fn().mockResolvedValue({});
    const innerFieldCaps = vi.fn().mockResolvedValue({});
    elasticCtor.mockImplementation(function ElasticClientMock() {
      return {
        search: innerSearch,
        fieldCaps: innerFieldCaps,
      };
    });
    const { createSearchClient } = await import('../src/search/client.js');
    const sc = await createSearchClient({
      backend: 'elasticsearch',
      url: 'https://es.example:9200',
      username: 'u',
      password: 'p',
      tlsInsecure: true,
      indexPattern: '*',
    });
    expect(elasticCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        node: 'https://es.example:9200',
        auth: { username: 'u', password: 'p' },
        tls: { rejectUnauthorized: false },
      }),
    );
    await sc.search({ index: 'i' });
    expect(innerSearch).toHaveBeenCalledWith({ index: 'i' });
  });

  it('constructs OpenSearch client without ssl override when TLS is secure', async () => {
    osCtor.mockImplementation(function OpenSearchClientMock() {
      return { search: vi.fn(), fieldCaps: vi.fn() };
    });
    const { createSearchClient } = await import('../src/search/client.js');
    await createSearchClient({
      backend: 'opensearch',
      url: 'https://os.example:9200',
      username: 'u',
      password: 'p',
      tlsInsecure: false,
      indexPattern: '*',
    });
    expect(osCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        node: 'https://os.example:9200',
        auth: { username: 'u', password: 'p' },
      }),
    );
    expect(osCtor.mock.calls[0]![0]).not.toHaveProperty('ssl');
  });

  it('passes ssl rejectUnauthorized when OpenSearch TLS insecure is true', async () => {
    osCtor.mockImplementation(function OpenSearchClientMock2() {
      return { search: vi.fn(), fieldCaps: vi.fn() };
    });
    const { createSearchClient } = await import('../src/search/client.js');
    await createSearchClient({
      backend: 'opensearch',
      url: 'https://os.example',
      username: 'u',
      password: 'p',
      tlsInsecure: true,
      indexPattern: '*',
    });
    expect(osCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: { rejectUnauthorized: false },
      }),
    );
  });
});
