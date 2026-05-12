import type { Logger } from 'pino';
import type { InsightSink } from './insightSink.js';

/** Writes insight text to structured logs (stdout with JSON logger). Used in console mode. */
export function createConsoleInsightSink(log: Logger): InsightSink {
  return {
    async postInsight(text: string) {
      log.info({ channel: 'console', insightText: text }, 'insight_post');
    },
  };
}
