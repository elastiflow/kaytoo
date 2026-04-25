import { beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { ErrorCode } from '@slack/web-api';

const slackPostMessage = vi.hoisted(() => vi.fn());

vi.mock('@slack/web-api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@slack/web-api')>();
  return {
    ...mod,
    WebClient: vi.fn(function () {
      return { chat: { postMessage: slackPostMessage } };
    }),
  };
});

describe('createSlackNotifierWithRetry', () => {
  beforeEach(() => {
    slackPostMessage.mockReset();
    slackPostMessage.mockResolvedValue(undefined);
  });

  it('retries transient Slack failures then succeeds', async () => {
    vi.useFakeTimers();
    slackPostMessage
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: ErrorCode.RequestError }))
      .mockResolvedValueOnce(undefined);

    const { createSlackNotifierWithRetry } = await import('../src/notify/slack.js');
    const log = pino({ level: 'silent' });
    const n = createSlackNotifierWithRetry({ botToken: 'xoxb', log });
    const p = n.postMessage({ channel: 'C1', text: 'hi' });

    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(slackPostMessage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('uses retryAfter seconds for rate limit backoff', async () => {
    vi.useFakeTimers();
    slackPostMessage
      .mockRejectedValueOnce({
        code: ErrorCode.RateLimitedError,
        retryAfter: 2,
      })
      .mockResolvedValueOnce(undefined);

    const { createSlackNotifierWithRetry } = await import('../src/notify/slack.js');
    const log = pino({ level: 'silent' });
    const n = createSlackNotifierWithRetry({ botToken: 'xoxb', log });
    const p = n.postMessage({ channel: 'C1', text: 'hi' });

    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(slackPostMessage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('createSlackNotifierWithRetry error classification', () => {
  beforeEach(() => {
    slackPostMessage.mockReset();
    slackPostMessage.mockResolvedValue(undefined);
  });

  async function runWithFakeTimers(postImpl: (...args: unknown[]) => unknown) {
    vi.useFakeTimers();
    slackPostMessage.mockImplementation(postImpl);
    const { createSlackNotifierWithRetry } = await import('../src/notify/slack.js');
    const log = pino({ level: 'silent' });
    const n = createSlackNotifierWithRetry({ botToken: 'xoxb', log });
    const p = n.postMessage({ channel: 'C1', text: 'hi' });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  }

  it('retries HTTP 502 platform errors', async () => {
    await runWithFakeTimers(
      vi
        .fn()
        .mockRejectedValueOnce({ code: ErrorCode.HTTPError, statusCode: 502 })
        .mockResolvedValueOnce(undefined),
    );
    expect(slackPostMessage).toHaveBeenCalledTimes(2);
  });

  it('retries Slack platform ratelimited errors', async () => {
    await runWithFakeTimers(
      vi
        .fn()
        .mockRejectedValueOnce({ code: ErrorCode.PlatformError, data: { error: 'ratelimited' } })
        .mockResolvedValueOnce(undefined),
    );
    expect(slackPostMessage).toHaveBeenCalledTimes(2);
  });

  it('retries TypeError fetch failed', async () => {
    await runWithFakeTimers(
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(undefined),
    );
    expect(slackPostMessage).toHaveBeenCalledTimes(2);
  });

  it('retries generic network reset errors', async () => {
    await runWithFakeTimers(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('read ECONNRESET'))
        .mockResolvedValueOnce(undefined),
    );
    expect(slackPostMessage).toHaveBeenCalledTimes(2);
  });
});
