export type SearchBackend = 'opensearch' | 'elasticsearch';

// The codebase is written against the OpenSearch client shape. For Elasticsearch support we
// adapt the Elasticsearch client to this shape at runtime (see `createSearchClient`).
export type SearchClient = import('@opensearch-project/opensearch').Client;

