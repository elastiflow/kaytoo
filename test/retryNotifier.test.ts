import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { ChatPost } from '../src/chat/types.js';
import type { Notifier } from '../src/notify/notifier.js';
import {
  createRetryNotifier,
  isRetryableMatrixError,
  isRetryableMattermostHttpError,
} from '../src/notify/retryNotifier.js';

const post: ChatPost = { address: { platform: 'matrix', channelId: '!r:example.com' }, text: 'hi' };
const silentLog = pino({ level: 'silent' });

function notifierFromPost(post: (input: ChatPost) => Promise<void>): Notifier {
  return { post };
}

describe('createRetryNotifier', () => {
  it('resolves on first success without sleeping', async () => {
    const inner = vi.fn().mockResolvedValue(undefined);
    const n = createRetryNotifier({
      inner: notifierFromPost(inner),
      log: silentLog,
      label: 'test.post',
      isRetryable: () => true,
    });

    await n.post(post);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures until success', async () => {
    vi.useFakeTimers();
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(undefined);

    const n = createRetryNotifier({
      inner: notifierFromPost(inner),
      log: silentLog,
      label: 'test.post',
      isRetryable: () => true,
      initialDelayMs: 10,
    });

    const p = n.post(post);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(inner).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('rethrows immediately on non-retryable errors', async () => {
    const inner = vi.fn().mockRejectedValue(new Error('bad request'));
    const n = createRetryNotifier({
      inner: notifierFromPost(inner),
      log: silentLog,
      label: 'test.post',
      isRetryable: () => false,
    });

    await expect(n.post(post)).rejects.toThrow('bad request');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableMattermostHttpError', () => {
  it('retries 5xx and 429 statuses', () => {
    expect(isRetryableMattermostHttpError(new Error('Mattermost post failed: 502 Bad Gateway'))).toBe(true);
    expect(isRetryableMattermostHttpError(new Error('Mattermost post failed: 429 Too Many Requests'))).toBe(true);
  });

  it('does not retry 4xx (other than 429)', () => {
    expect(isRetryableMattermostHttpError(new Error('Mattermost post failed: 401 Unauthorized'))).toBe(false);
    expect(isRetryableMattermostHttpError(new Error('Mattermost post failed: 400 Bad Request'))).toBe(false);
  });

  it('retries network errors', () => {
    expect(isRetryableMattermostHttpError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableMattermostHttpError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('does not retry unrelated errors', () => {
    expect(isRetryableMattermostHttpError(new Error('parse error'))).toBe(false);
    expect(isRetryableMattermostHttpError(null)).toBe(false);
  });
});

describe('isRetryableMatrixError', () => {
  it('retries 5xx and 429 statuses', () => {
    expect(isRetryableMatrixError({ httpStatus: 503 })).toBe(true);
    expect(isRetryableMatrixError({ httpStatus: 429 })).toBe(true);
  });

  it('retries M_LIMIT_EXCEEDED', () => {
    expect(isRetryableMatrixError({ errcode: 'M_LIMIT_EXCEEDED' })).toBe(true);
  });

  it('retries network/timeout errors', () => {
    expect(isRetryableMatrixError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableMatrixError({ name: 'ConnectionError' })).toBe(true);
    expect(isRetryableMatrixError({ name: 'TimeoutError' })).toBe(true);
  });

  it('does not retry 4xx (other than 429) or unrelated errors', () => {
    expect(isRetryableMatrixError({ httpStatus: 403 })).toBe(false);
    expect(isRetryableMatrixError(null)).toBe(false);
    expect(isRetryableMatrixError(new Error('parse error'))).toBe(false);
  });
});
