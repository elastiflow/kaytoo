export type ChatPlatform = 'slack' | 'matrix' | 'mattermost' | 'e2e';

export type ChatAddress = {
  platform: ChatPlatform;
  workspaceId?: string;
  channelId: string;
  threadId?: string;
};

export type ChatUser = {
  id: string;
  displayName?: string;
};

export type ChatMessageEvent = {
  type: 'message';
  platform: ChatPlatform;
  address: ChatAddress;
  user: ChatUser;
  text: string;
  ts: string;
  /** Adapter-specific correlation (e.g. Matrix event_id) */
  eventId?: string;
};

export type ChatEvent = ChatMessageEvent;

export type ChatPost = {
  address: ChatAddress;
  text: string;
};

