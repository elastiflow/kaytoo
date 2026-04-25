import type { Logger } from 'pino';
import { logErr } from '../logging/logger.js';
import { sleepMsAbortable } from './sleep.js';

export function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  return (e as Error).name === 'AbortError';
}

export type UntilSuccessWithBackoffOpts<T> = {
  tryOp: () => Promise<T>;
  isRetryable: (err: unknown) => boolean;
  log: Logger;
  logLabel: string;
  initialDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  signal?: AbortSignal;
  /** After a retryable failure, pick wait time in ms (defaults to current backoff delay before it is multiplied). */
  pickDelayMs?: (err: unknown, backoffDelayMs: number) => number;
};

/**
 * Repeats `tryOp` until it succeeds. On retryable errors, logs at `error`, waits with exponential
 * backoff (capped), then retries. Non-retryable errors are logged and rethrown. AbortError rethrows.
 */
export async function untilSuccessWithBackoff<T>(opts: UntilSuccessWithBackoffOpts<T>): Promise<T> {
  const initial = opts.initialDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 120_000;
  const mult = opts.multiplier ?? 2;

  const step = async (attempt: number, delay: number): Promise<T> => {
    opts.signal?.throwIfAborted();
    try {
      return await opts.tryOp();
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (!opts.isRetryable(e)) {
        opts.log.error({ ...logErr(e), attempt }, `${opts.logLabel} failed (non-retryable)`);
        throw e;
      }
      const waitMs = opts.pickDelayMs?.(e, delay) ?? delay;
      opts.log.error({ ...logErr(e), attempt, waitMs }, `${opts.logLabel} failed; retrying`);
      await sleepMsAbortable(waitMs, opts.signal);
      const nextDelay = Math.min(max, Math.floor(delay * mult));
      return step(attempt + 1, nextDelay);
    }
  };

  return step(1, initial);
}
