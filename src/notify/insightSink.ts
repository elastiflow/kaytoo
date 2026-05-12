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

// Resolves if any sink succeeds; rejects only when every sink fails. Inner
// notifiers own per-sink failure logging.
export function createMultiInsightSink(opts: { sinks: readonly InsightSink[] }): InsightSink {
  const { sinks } = opts;
  return {
    async postInsight(text: string): Promise<void> {
      if (sinks.length === 0) return;
      const results = await Promise.allSettled(sinks.map((s) => s.postInsight(text)));
      const reasons = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
      if (reasons.length !== sinks.length) return;
      throw reasons.length === 1 ? reasons[0] : new AggregateError(reasons, 'all insight sinks failed');
    },
  };
}
