import type { ChatPost } from '../chat/types.js';

export type Notifier = {
  post(input: ChatPost): Promise<void>;
};

