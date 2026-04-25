import type { SlackNotifier } from './slack.js';
import type { Notifier } from './notifier.js';
import type { ChatPost } from '../chat/types.js';

export function createSlackChatNotifier(opts: {
  slack: SlackNotifier;
  defaultChannelId?: string;
}): Notifier {
  return {
    async post(input: ChatPost): Promise<void> {
      if (input.address.platform !== 'slack') {
        throw new Error(`Slack notifier cannot post to platform=${input.address.platform}`);
      }
      const cid = input.address.channelId;
      const channel = cid != null && cid !== '' ? cid : (opts.defaultChannelId ?? '');
      await opts.slack.postMessage({
        channel,
        text: input.text,
        ...(input.address.platform === 'slack' && input.address.threadId
          ? { threadTs: input.address.threadId }
          : {}),
      });
    },
  };
}

