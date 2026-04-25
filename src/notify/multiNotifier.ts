import type { Notifier } from './notifier.js';
import type { ChatPost } from '../chat/types.js';

/** For notifiers whose client is ready only after an async bootstrap (e.g. Matrix). */
export function createPromiseBackedNotifier(
  promise: Promise<Notifier | null>,
  notConfiguredMessage: string,
): Notifier {
  return {
    async post(input: ChatPost): Promise<void> {
      const n = await promise;
      if (!n) throw new Error(notConfiguredMessage);
      await n.post(input);
    },
  };
}

export function createMultiNotifier(opts: {
  slack?: Notifier;
  matrix?: Notifier;
  mattermost?: Notifier;
}): Notifier {
  return {
    async post(input: ChatPost): Promise<void> {
      const n =
        input.address.platform === 'slack'
          ? opts.slack
          : input.address.platform === 'matrix'
            ? opts.matrix
            : opts.mattermost;
      if (!n) throw new Error(`No notifier configured for platform=${input.address.platform}`);
      await n.post(input);
    },
  };
}

