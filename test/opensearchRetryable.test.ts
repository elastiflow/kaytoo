import { describe, expect, it } from 'vitest';
import { errors } from '@opensearch-project/opensearch';
import { isRetryableOpenSearchError } from '../src/opensearch/retryableOpenSearchError.js';

describe('isRetryableOpenSearchError', () => {
  it('treats transport errors as retryable', () => {
    expect(isRetryableOpenSearchError(new errors.ConnectionError('socket hang up'))).toBe(true);
    expect(isRetryableOpenSearchError(new errors.TimeoutError('timeout', {} as never))).toBe(true);
    expect(isRetryableOpenSearchError(new errors.NoLivingConnectionsError('none', {} as never))).toBe(true);
  });

  it('does not retry client auth failures', () => {
    const e401 = new errors.ResponseError({ statusCode: 401, body: {}, headers: {} } as never);
    expect(isRetryableOpenSearchError(e401)).toBe(false);
    const e403 = new errors.ResponseError({ statusCode: 403, body: {}, headers: {} } as never);
    expect(isRetryableOpenSearchError(e403)).toBe(false);
  });

  it('retries server errors and rate limits', () => {
    const e503 = new errors.ResponseError({ statusCode: 503, body: {}, headers: {} } as never);
    expect(isRetryableOpenSearchError(e503)).toBe(true);
    const e429 = new errors.ResponseError({ statusCode: 429, body: {}, headers: {} } as never);
    expect(isRetryableOpenSearchError(e429)).toBe(true);
  });

  it('does not retry request aborts', () => {
    expect(isRetryableOpenSearchError(new errors.RequestAbortedError('aborted', {} as never))).toBe(false);
  });

  it('returns false for nullish and plain objects', () => {
    expect(isRetryableOpenSearchError(null)).toBe(false);
    expect(isRetryableOpenSearchError(undefined)).toBe(false);
    expect(isRetryableOpenSearchError({})).toBe(false);
  });

  it('returns false for client 4xx other than auth', () => {
    const e404 = new errors.ResponseError({ statusCode: 404, body: {}, headers: {} } as never);
    expect(isRetryableOpenSearchError(e404)).toBe(false);
  });

  it('returns true for errno-style transport errors', () => {
    expect(isRetryableOpenSearchError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isRetryableOpenSearchError(Object.assign(new Error('pipe'), { code: 'EPIPE' }))).toBe(true);
  });

  it('returns true for duck-typed connection error names', () => {
    expect(isRetryableOpenSearchError(Object.assign(new Error('x'), { name: 'ConnectionError' }))).toBe(true);
    expect(isRetryableOpenSearchError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
  });
});
