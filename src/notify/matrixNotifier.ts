import type { MatrixClient } from 'matrix-js-sdk';
import type { Notifier } from './notifier.js';
import type { ChatPost } from '../chat/types.js';
import { matrixMessageBodies } from './matrixFormat.js';

export function createMatrixNotifier(client: MatrixClient): Notifier {
  return {
    async post(input: ChatPost): Promise<void> {
      if (input.address.platform !== 'matrix') {
        throw new Error(`Matrix notifier cannot post to platform=${input.address.platform}`);
      }
      const { channelId, threadId } = input.address;
      const { plain, html } = matrixMessageBodies(input.text);
      if (threadId && threadId !== 'main') {
        await client.sendHtmlMessage(channelId, threadId, plain, html);
      } else {
        await client.sendHtmlMessage(channelId, plain, html);
      }
    },
  };
}
