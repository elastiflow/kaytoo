import {
  createClient,
  type MatrixClient,
  type MatrixEvent,
  MemoryStore,
  type Membership,
  type Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { getLogger } from '../../logging/logger.js';
import { createMatrixJsSdkLogger, type MatrixSdkLevel } from '../../logging/matrixSdkLogger.js';
import type { ChatEvent } from '../types.js';

const log = getLogger({ component: 'chat.matrix' });

export type MatrixAuth = { accessToken: string } | { user: string; password: string };

async function whoamiUserId(baseUrl: string, accessToken: string): Promise<string | undefined> {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL('_matrix/client/v3/account/whoami', root);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) return undefined;
  const body = (await resp.json()) as { user_id?: string };
  return typeof body.user_id === 'string' ? body.user_id : undefined;
}

function loginIdentifier(user: string): { type: 'm.id.user'; user: string } {
  const localpart = user.startsWith('@') ? user.replace(/^@/, '').split(':')[0]! : user;
  return { type: 'm.id.user', user: localpart };
}

export async function startMatrixAdapter(opts: {
  homeserverUrl: string;
  auth: MatrixAuth;
  matrixSdkLevel: MatrixSdkLevel;
  defaultRoomId?: string;
  onEvent: (evt: ChatEvent) => Promise<void>;
}): Promise<{ stop: () => Promise<void>; client: MatrixClient }> {
  const logger = createMatrixJsSdkLogger(opts.matrixSdkLevel);
  const userId =
    'accessToken' in opts.auth ? await whoamiUserId(opts.homeserverUrl, opts.auth.accessToken) : undefined;

  const client = createClient({
    baseUrl: opts.homeserverUrl,
    ...('accessToken' in opts.auth ? { accessToken: opts.auth.accessToken } : {}),
    ...(userId ? { userId } : {}),
    store: new MemoryStore(),
    logger,
    timelineSupport: true,
  });

  if ('user' in opts.auth) {
    const resp = await client.loginRequest({
      type: 'm.login.password',
      identifier: loginIdentifier(opts.auth.user),
      password: opts.auth.password,
      initial_device_display_name: 'kaytoo',
    });
    client.setAccessToken(resp.access_token);
    client.credentials = { userId: resp.user_id };
  }

  const onTimeline = async (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
  ): Promise<void> => {
    if (toStartOfTimeline) return;
    if (event.status !== null) return;
    if (event.getType() !== 'm.room.message') return;
    const content = event.getContent<{ msgtype?: string; body?: string }>();
    if (content?.msgtype !== 'm.text') return;
    const body = content.body;
    if (typeof body !== 'string' || !body.trim()) return;
    const sender = event.getSender();
    if (!sender) return;
    const myId = client.getUserId();
    if (myId && sender === myId) return;
    const roomId = room?.roomId ?? event.getRoomId();
    if (!roomId) return;
    const eventId = event.getId() ?? '';
    /** Thread root for MSC threads; `main` sentinel for main-timeline (memory + non-threaded replies). */
    const threadKey = event.threadRootId ?? 'main';
    const normalized: ChatEvent = {
      type: 'message',
      platform: 'matrix',
      address: {
        platform: 'matrix',
        channelId: roomId,
        threadId: threadKey,
      },
      user: { id: sender },
      text: body,
      ts: new Date().toISOString(),
      ...(eventId ? { eventId } : {}),
    };
    await opts.onEvent(normalized);
  };

  const onMyMembership = async (room: Room, membership: Membership): Promise<void> => {
    if (membership !== 'invite') return;
    try {
      await client.joinRoom(room.roomId);
      log.info({ roomId: room.roomId }, 'matrix joined invited room');
    } catch (e) {
      log.warn({ roomId: room.roomId, err: e }, 'matrix failed to join invited room');
    }
  };

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(RoomEvent.MyMembership, onMyMembership);

  await client.startClient({ initialSyncLimit: 20 });

  if (opts.defaultRoomId) {
    try {
      await client.joinRoom(opts.defaultRoomId);
      log.info({ roomId: opts.defaultRoomId }, 'matrix joined default room');
    } catch (e) {
      log.error(
        { roomId: opts.defaultRoomId, botUserId: client.getUserId() ?? undefined, err: e },
        'matrix cannot join default room; invite the bot user, then restart',
      );
    }
  }

  log.info({ homeserverUrl: opts.homeserverUrl }, 'matrix adapter started');

  return {
    client,
    stop: async () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
      client.removeListener(RoomEvent.MyMembership, onMyMembership);
      await client.stopClient();
    },
  };
}
