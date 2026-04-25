import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { untilSuccessWithBackoff, isAbortError } from '../src/util/retryBackoff.js';
import { sleepMsAbortable } from '../src/util/sleep.js';

describe('untilSuccessWithBackoff', () => {
  it('retries until tryOp succeeds', async () => {
    vi.useFakeTimers();
    const log = pino({ level: 'silent' });
    const attempts = { n: 0 };
    const p = untilSuccessWithBackoff({
      tryOp: async () => {
        attempts.n += 1;
        if (attempts.n < 3) throw new Error('transient');
        return 'ok';
      },
      isRetryable: () => true,
      log,
      logLabel: 'test-op',
      initialDelayMs: 10,
      maxDelayMs: 100,
      multiplier: 2,
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();

    await expect(p).resolves.toBe('ok');
    expect(attempts.n).toBe(3);

    vi.useRealTimers();
  });

  it('throws on non-retryable errors', async () => {
    const log = pino({ level: 'silent' });
    await expect(
      untilSuccessWithBackoff({
        tryOp: async () => {
          throw new Error('bad');
        },
        isRetryable: () => false,
        log,
        logLabel: 'test-op',
      }),
    ).rejects.toThrow('bad');
  });

  it('rethrows AbortError', async () => {
    const log = pino({ level: 'silent' });
    const ac = new AbortController();
    const p = untilSuccessWithBackoff({
      tryOp: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
      isRetryable: () => true,
      log,
      logLabel: 'test-op',
      initialDelayMs: 1000,
      signal: ac.signal,
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('isAbortError', () => {
  it('detects AbortError', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});

describe('sleepMsAbortable', () => {
  it('rejects when signal aborts during wait', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = sleepMsAbortable(10_000, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();
  });
});
