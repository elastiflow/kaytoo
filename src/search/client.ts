import type { KaytooConfig } from '../config.js';
import type { SearchClient } from './types.js';

export async function createSearchClient(config: KaytooConfig['search']): Promise<SearchClient> {
  if (config.backend === 'elasticsearch') {
    const { Client: ElasticClient } = await import('@elastic/elasticsearch');
    const client = new ElasticClient({
      node: config.url,
      auth: { username: config.username, password: config.password },
      ...(config.tlsInsecure ? { tls: { rejectUnauthorized: false } } : {}),
    });
    const adapted = {
      search: (params: unknown) => client.search(params as never) as unknown,
      fieldCaps: (params: unknown) => client.fieldCaps(params as never) as unknown,
    };
    return adapted as unknown as SearchClient;
  }

  const { Client: OpenSearchClient } = await import('@opensearch-project/opensearch');
  const client = new OpenSearchClient({
    node: config.url,
    auth: { username: config.username, password: config.password },
    ...(config.tlsInsecure ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  return client as unknown as SearchClient;
}

