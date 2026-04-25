import type { Notifier } from './notifier.js';
import type { ChatPost } from '../chat/types.js';

export function createMattermostNotifier(opts: { baseUrl: string; token: string }): Notifier {
  return {
    async post(input: ChatPost): Promise<void> {
      if (input.address.platform !== 'mattermost') {
        throw new Error(`Mattermost notifier cannot post to platform=${input.address.platform}`);
      }

      const resp = await fetch(new URL('/api/v4/posts', opts.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.token}`,
        },
        body: JSON.stringify({
          channel_id: input.address.channelId,
          message: input.text,
          ...(input.address.threadId ? { root_id: input.address.threadId } : {}),
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Mattermost post failed: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`);
      }
    },
  };
}

