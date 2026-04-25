import type { Logger } from 'pino';
import type { SlackNotifier } from './slack.js';

/** Same contract as Slack `postMessage`; writes insight text to structured logs (stdout with JSON logger). */
export function createConsoleInsightSink(log: Logger): SlackNotifier {
  return {
    async postMessage(input: { channel: string; text: string }) {
      log.info({ channel: input.channel, insightText: input.text }, 'insight_post');
    },
  };
}
