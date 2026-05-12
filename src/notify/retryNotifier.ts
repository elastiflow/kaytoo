import type { Logger } from 'pino';
import { untilSuccessWithBackoff } from '../util/retryBackoff.js';
import type { ChatPost } from '../chat/types.js';
import type { Notifier } from './notifier.js';

export type CreateRetryNotifierOpts = {
  inner: Notifier;
  log: Logger;
  label: string;
  isRetryable: (err: unknown) => boolean;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

export function createRetryNotifier(opts: CreateRetryNotifierOpts): Notifier {
  return {
    async post(input: ChatPost): Promise<void> {
      await untilSuccessWithBackoff({
        tryOp: () => opts.inner.post(input),
        isRetryable: opts.isRetryable,
        log: opts.log,
        logLabel: opts.label,
        initialDelayMs: opts.initialDelayMs ?? 1000,
        maxDelayMs: opts.maxDelayMs ?? 120_000,
      });
    },
  };
}

function networkErrorMessage(e: unknown): boolean {
  if (e instanceof TypeError) return /fetch failed|network/i.test(e.message);
  if (e instanceof Error) return /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(e.message);
  return false;
}

export function isRetryableMattermostHttpError(e: unknown): boolean {
  if (networkErrorMessage(e)) return true;
  if (!(e instanceof Error)) return false;
  const m = /Mattermost post failed: (\d+)/.exec(e.message);
  if (!m) return false;
  const code = Number(m[1]);
  return code === 429 || (code >= 500 && code < 600);
}

export function isRetryableMatrixError(e: unknown): boolean {
  if (networkErrorMessage(e)) return true;
  if (!e || typeof e !== 'object') return false;
  const o = e as { httpStatus?: number; errcode?: string; name?: string };
  if (typeof o.httpStatus === 'number' && (o.httpStatus === 429 || o.httpStatus >= 500)) return true;
  if (o.errcode === 'M_LIMIT_EXCEEDED') return true;
  return o.name === 'ConnectionError' || o.name === 'TimeoutError';
}
