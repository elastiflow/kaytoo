import type { Logger } from 'pino';
import { logErr } from '../logging/logger.js';
import type { ChatAddress } from '../chat/types.js';
import type { Notifier } from './notifier.js';

export type InsightSink = {
  postInsight(text: string): Promise<void>;
};

export function createPlatformInsightSink(notifier: Notifier, address: ChatAddress): InsightSink {
  return {
    postInsight: (text) => notifier.post({ address, text }),
  };
}

export function createMultiInsightSink(opts: {
  sinks: readonly InsightSink[];
  log: Logger;
}): InsightSink {
  const { sinks, log } = opts;
  return {
    async postInsight(text: string): Promise<void> {
      if (sinks.length === 0) return;
      const results = await Promise.allSettled(sinks.map((s) => s.postInsight(text)));
      for (const [i, r] of results.entries()) {
        if (r.status === 'rejected') log.warn({ ...logErr(r.reason), sinkIndex: i }, 'insight sink failed');
      }
    },
  };
}
