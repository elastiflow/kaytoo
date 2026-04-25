import { SocketModeClient } from '@slack/socket-mode';
import { getLogger } from '../../logging/logger.js';
import { getString, isRecord } from '../../util/guards.js';
import type { ChatEvent } from '../types.js';

const log = getLogger({ component: 'chat.slack' });

export async function startSlackSocketAdapter(opts: {
  appToken: string;
  onEvent: (evt: ChatEvent) => Promise<void>;
}): Promise<{ stop: () => Promise<void> }> {
  const socket = new SocketModeClient({ appToken: opts.appToken });

  socket.on('slack_event', async (args: unknown) => {
    const a = isRecord(args) ? args : {};
    const ack = a['ack'];
    if (typeof ack === 'function') await (ack as () => Promise<void> | void)();

    const body = a['body'];
    const payload = (body ?? a['payload']) as unknown;
    log.debug({ hasPayload: !!payload }, 'slack_event received');
    const normalized = normalizeSlackEventCallback(payload);
    if (!normalized) return;
    await opts.onEvent(normalized);
  });

  await socket.start();
  log.info('slack socket adapter started');

  return {
    stop: async () => {
      await socket.disconnect();
    },
  };
}

export function normalizeSlackEventCallback(payload: unknown): ChatEvent | null {
  if (!isRecord(payload)) return null;
  if (payload['type'] !== 'event_callback') return null;

  const ev = payload['event'];
  if (!isRecord(ev)) return null;
  if (ev['type'] !== 'message') return null;
  if (typeof ev['subtype'] === 'string' && ev['subtype']) return null; // ignore message_changed, bot_message, etc.
  if (typeof ev['bot_id'] === 'string' && ev['bot_id']) return null;

  const text = getString(ev['text']);
  const user = getString(ev['user']);
  const channel = getString(ev['channel']);
  const ts = getString(ev['ts']);
  if (!text || !user || !channel || !ts) return null;

  const threadTs = getString(ev['thread_ts']);

  const addressBase = {
    platform: 'slack' as const,
    channelId: channel,
    threadId: threadTs || ts,
  };
  const teamId = getString(payload['team_id']);
  const address = teamId ? { ...addressBase, workspaceId: teamId } : addressBase;

  return {
    type: 'message',
    platform: 'slack',
    address,
    user: { id: user },
    text,
    ts,
  };
}

