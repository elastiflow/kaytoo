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

// Fans out an insight to multiple sinks. Inner notifiers (e.g. RetryNotifier) are
// expected to log their own failures. Resolves if at least one sink succeeds, and
// rejects with the underlying reason(s) only when every sink fails so the caller
// can log the outcome once.
export function createMultiInsightSink(opts: { sinks: readonly InsightSink[] }): InsightSink {
  const { sinks } = opts;
  return {
    async postInsight(text: string): Promise<void> {
      if (sinks.length === 0) return;
      const results = await Promise.allSettled(sinks.map((s) => s.postInsight(text)));
      const reasons = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason);
      if (reasons.length === sinks.length) {
        throw reasons.length === 1
          ? reasons[0]
          : new AggregateError(reasons, 'all insight sinks failed');
      }
    },
  };
}
