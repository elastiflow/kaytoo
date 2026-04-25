import type { Logger } from 'pino';
import { ErrorCode, type WebAPIHTTPError, type WebAPIPlatformError, WebClient } from '@slack/web-api';
import { untilSuccessWithBackoff } from '../util/retryBackoff.js';

export type SlackNotifier = {
  postMessage(input: { channel: string; text: string; threadTs?: string }): Promise<void>;
};

export function createSlackNotifier(opts: { botToken: string }): SlackNotifier {
  const client = new WebClient(opts.botToken);

  return {
    async postMessage(input: { channel: string; text: string; threadTs?: string }): Promise<void> {
      await client.chat.postMessage({
        channel: input.channel,
        text: input.text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      });
    },
  };
}

function slackUnhandledNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return /fetch failed|network/i.test(e.message);
  if (e instanceof Error) return /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(e.message);
  return false;
}

function isRetryableSlackPostError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return slackUnhandledNetworkError(e);
  const code = (e as { code?: string }).code;
  if (code === ErrorCode.RequestError) return true;
  if (code === ErrorCode.HTTPError) {
    const sc = (e as WebAPIHTTPError).statusCode;
    return typeof sc === 'number' && (sc >= 500 || sc === 429);
  }
  if (code === ErrorCode.RateLimitedError) return true;
  if (code === ErrorCode.PlatformError) {
    const err = (e as WebAPIPlatformError).data?.error;
    if (typeof err !== 'string') return false;
    return ['service_unavailable', 'internal_error', 'request_timeout', 'ratelimited'].includes(err);
  }
  return slackUnhandledNetworkError(e);
}

function pickSlackBackoffDelay(err: unknown, backoffDelayMs: number): number {
  if (!err || typeof err !== 'object') return backoffDelayMs;
  const o = err as { code?: string; retryAfter?: number };
  if (o.code === ErrorCode.RateLimitedError && typeof o.retryAfter === 'number' && Number.isFinite(o.retryAfter)) {
    return Math.min(600_000, Math.max(1000, o.retryAfter * 1000));
  }
  return backoffDelayMs;
}

/** Same as {@link createSlackNotifier}, but `postMessage` retries transient Slack / network failures with exponential backoff. */
export function createSlackNotifierWithRetry(opts: { botToken: string; log: Logger }): SlackNotifier {
  const inner = createSlackNotifier({ botToken: opts.botToken });
  return {
    async postMessage(input: { channel: string; text: string }): Promise<void> {
      await untilSuccessWithBackoff({
        tryOp: () => inner.postMessage(input),
        isRetryable: isRetryableSlackPostError,
        log: opts.log,
        logLabel: 'Slack postMessage',
        initialDelayMs: 1000,
        maxDelayMs: 120_000,
        pickDelayMs: pickSlackBackoffDelay,
      });
    },
  };
}

