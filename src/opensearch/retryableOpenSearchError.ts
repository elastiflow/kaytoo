import { errors } from '@opensearch-project/opensearch';

/** True when the failure is likely transient (network, overload) and worth backing off and retrying. */
export function isRetryableOpenSearchError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;

  if (e instanceof errors.ConnectionError || e instanceof errors.TimeoutError || e instanceof errors.NoLivingConnectionsError) {
    return true;
  }
  if (e instanceof errors.RequestAbortedError) return false;
  if (e instanceof errors.ResponseError) {
    const sc = e.statusCode;
    if (sc === 401 || sc === 403) return false;
    if (sc >= 500 || sc === 429) return true;
    if (sc >= 400 && sc < 500) return false;
    return false;
  }

  const code = (e as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE'].includes(code)) {
    return true;
  }

  const name = (e as Error).name;
  if (name === 'ConnectionError' || name === 'TimeoutError' || name === 'NoLivingConnectionsError') return true;

  return false;
}
