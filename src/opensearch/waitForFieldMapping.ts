import type { Logger } from 'pino';
import type { SearchClient } from '../search/types.js';
import { chooseFields, type FieldPreference } from './fieldCaps.js';
import { isRetryableOpenSearchError } from './retryableOpenSearchError.js';
import { untilSuccessWithBackoff } from '../util/retryBackoff.js';

export async function waitForOpenSearchFieldMapping(opts: {
  client: SearchClient;
  indexPattern: string;
  log: Logger;
  signal?: AbortSignal;
}): Promise<FieldPreference> {
  return untilSuccessWithBackoff({
    tryOp: () => chooseFields({ client: opts.client, index: opts.indexPattern }),
    isRetryable: isRetryableOpenSearchError,
    log: opts.log,
    ...(opts.signal ? { signal: opts.signal } : {}),
    logLabel: 'OpenSearch field mapping',
    initialDelayMs: 1000,
    maxDelayMs: 120_000,
  });
}
