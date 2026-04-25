import { Client as ElasticClient } from '@elastic/elasticsearch';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type { KaytooConfig } from '../config.js';
import type { SearchClient } from './types.js';

export function createSearchClient(config: KaytooConfig['search']): SearchClient {
  if (config.backend === 'elasticsearch') {
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

  const client = new OpenSearchClient({
    node: config.url,
    auth: { username: config.username, password: config.password },
    ...(config.tlsInsecure ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  return client as unknown as SearchClient;
}

