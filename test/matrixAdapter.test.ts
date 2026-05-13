import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Membership, Room } from 'matrix-js-sdk';

const timelineHandlers: Array<(e: MatrixEvent, room: Room | undefined, toStart: boolean | undefined) => void> = [];
const membershipHandlers: Array<(room: Room, m: Membership) => void> = [];

vi.mock('matrix-js-sdk', () => ({
  RoomEvent: { Timeline: 'Timeline', MyMembership: 'MyMembership' },
  MemoryStore: vi.fn(),
  createClient: vi.fn(() => ({
    on: vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
      if (ev === 'Timeline') timelineHandlers.push(fn as (typeof timelineHandlers)[0]);
      if (ev === 'MyMembership') membershipHandlers.push(fn as (typeof membershipHandlers)[0]);
    }),
    removeListener: vi.fn(),
    startClient: vi.fn().mockResolvedValue(undefined),
    stopClient: vi.fn().mockResolvedValue(undefined),
    joinRoom: vi.fn().mockResolvedValue({}),
    getUserId: vi.fn().mockReturnValue('@bot:hs'),
    loginRequest: vi.fn().mockResolvedValue({ access_token: 'srv-tok', user_id: '@bot:hs' }),
    setAccessToken: vi.fn(),
    credentials: undefined as unknown,
  })),
}));

vi.mock('../src/logging/matrixSdkLogger.js', () => ({
  createMatrixJsSdkLogger: vi.fn(() => ({})),
}));

import { createClient } from 'matrix-js-sdk';
import { startMatrixAdapter } from '../src/chat/adapters/matrix.js';

function mkRoom(id: string): Room {
  return { roomId: id } as Room;
}

function mkEvent(over: Partial<{
  status: unknown;
  type: string;
  msgtype: string;
  body: string;
  sender: string;
  id: string;
  roomId: string;
  threadRootId: string | undefined;
  ts: number;
}>): MatrixEvent {
  const o = {
    status: null,
    type: 'm.room.message',
    msgtype: 'm.text',
    body: 'hello',
    sender: '@u:hs',
    id: '$1',
    roomId: '!r:hs',
    threadRootId: undefined as string | undefined,
    ts: 1_700_000_000_000,
    ...over,
  };
  return {
    status: o.status,
    getType: () => o.type,
    getContent: () => ({ msgtype: o.msgtype, body: o.body }),
    getSender: () => o.sender,
    getId: () => o.id,
    getRoomId: () => o.roomId,
    getTs: () => o.ts,
    threadRootId: o.threadRootId,
  } as MatrixEvent;
}

describe('startMatrixAdapter', () => {
  afterEach(() => {
    timelineHandlers.length = 0;
    membershipHandlers.length = 0;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('registers client, resolves whoami, joins default room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop, client } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'WARN',
      defaultRoomId: '!def:hs',
      onEvent,
    });
    expect(createClient).toHaveBeenCalled();
    expect(vi.mocked(client.joinRoom)).toHaveBeenCalledWith('!def:hs');
    await stop();
    expect(client.removeListener).toHaveBeenCalled();
    expect(client.stopClient).toHaveBeenCalled();
  });

  it('timeline ignores sync backfill, pending edits, non-text, self, empty room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent,
    });
    const h = timelineHandlers[0]!;
    const room = mkRoom('!r:hs');
    await h(mkEvent({}), room, true);
    await h(mkEvent({ status: 'sending' }), room, false);
    await h(mkEvent({ type: 'm.other' }), room, false);
    await h(mkEvent({ msgtype: 'm.image' }), room, false);
    await h(mkEvent({ body: '   ' }), room, false);
    await h(mkEvent({ sender: '' }), room, false);
    await h(mkEvent({ sender: '@bot:hs' }), room, false);
    await h(mkEvent({ roomId: '', id: '' }), undefined, false);
    expect(onEvent).not.toHaveBeenCalled();
    await stop();
  });

  it('emits chat event for text message from another user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent,
    });
    const h = timelineHandlers[0]!;
    await h(mkEvent({ body: 'ping', sender: '@peer:hs', id: '$e1', ts: 1_720_000_000_000 }), mkRoom('!room:hs'), false);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'matrix',
        text: 'ping',
        address: expect.objectContaining({ channelId: '!room:hs', threadId: 'main' }),
        eventId: '$e1',
        ts: new Date(1_720_000_000_000).toISOString(),
      }),
    );
    await stop();
  });

  it('uses thread root id when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent,
    });
    await timelineHandlers[0]!(
      mkEvent({ threadRootId: '$root', sender: '@peer:hs' }),
      mkRoom('!room:hs'),
      false,
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ threadId: '$root' }) }),
    );
    await stop();
  });

  it('joinRoom on invite membership', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const { client, stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    await membershipHandlers[0]!(mkRoom('!inv:hs'), 'invite' as Membership);
    expect(client.joinRoom).toHaveBeenCalledWith('!inv:hs');
    await membershipHandlers[0]!(mkRoom('!j:hs'), 'join' as Membership);
    await stop();
  });

  it('joinRoom failure on invite is swallowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const { client, stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(client.joinRoom).mockRejectedValueOnce(new Error('no join'));
    await membershipHandlers[0]!(mkRoom('!inv:hs'), 'invite' as Membership);
    await stop();
  });

  it('default room join failure is swallowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: '@bot:hs' }) }),
    );
    const joinRoom = vi.fn().mockRejectedValueOnce(new Error('no room'));
    vi.mocked(createClient).mockImplementationOnce(
      () =>
        ({
          on: vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
            if (ev === 'Timeline') timelineHandlers.push(fn as (typeof timelineHandlers)[0]);
            if (ev === 'MyMembership') membershipHandlers.push(fn as (typeof membershipHandlers)[0]);
          }),
          removeListener: vi.fn(),
          startClient: vi.fn().mockResolvedValue(undefined),
          stopClient: vi.fn().mockResolvedValue(undefined),
          joinRoom,
          getUserId: vi.fn().mockReturnValue('@bot:hs'),
        }) as unknown as MatrixClient,
    );
    const { stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      defaultRoomId: '!bad:hs',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    expect(joinRoom).toHaveBeenCalledWith('!bad:hs');
    await stop();
  });

  it('works when whoami returns no user_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    expect(vi.mocked(createClient).mock.calls[0]![0]).not.toHaveProperty('userId');
    await stop();
  });

  it('whoami HTTP error omits userId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { stop } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { accessToken: 'tok' },
      matrixSdkLevel: 'ERROR',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    expect(vi.mocked(createClient).mock.calls[0]![0]).not.toHaveProperty('userId');
    await stop();
  });

  it('uses matrix-js-sdk login with m.login.password and installs returned credentials', async () => {
    const { stop, client } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { user: 'kaytoo', password: 'pw' },
      matrixSdkLevel: 'ERROR',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    const createArgs = vi.mocked(createClient).mock.calls[0]![0] as {
      accessToken?: string;
      userId?: string;
    };
    expect(createArgs.accessToken).toBeUndefined();
    expect(createArgs.userId).toBeUndefined();
    expect(client.loginRequest).toHaveBeenCalledWith({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: 'kaytoo' },
      password: 'pw',
      initial_device_display_name: 'kaytoo',
    });
    expect(client.setAccessToken).toHaveBeenCalledWith('srv-tok');
    expect((client as unknown as { credentials: { userId: string } }).credentials).toEqual({ userId: '@bot:hs' });
    await stop();
  });

  it('strips MXID prefix/suffix when building login identifier', async () => {
    const { stop, client } = await startMatrixAdapter({
      homeserverUrl: 'https://hs',
      auth: { user: '@kaytoo:matrix.example.org', password: 'pw' },
      matrixSdkLevel: 'ERROR',
      onEvent: vi.fn().mockResolvedValue(undefined),
    });
    expect(client.loginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: 'kaytoo' },
      }),
    );
    await stop();
  });

  it('propagates errors from matrix-js-sdk login', async () => {
    vi.mocked(createClient).mockImplementationOnce(
      () =>
        ({
          on: vi.fn(),
          removeListener: vi.fn(),
          startClient: vi.fn().mockResolvedValue(undefined),
          stopClient: vi.fn().mockResolvedValue(undefined),
          joinRoom: vi.fn().mockResolvedValue({}),
          getUserId: vi.fn().mockReturnValue('@bot:hs'),
          loginRequest: vi.fn().mockRejectedValue(new Error('M_FORBIDDEN: Invalid password')),
          setAccessToken: vi.fn(),
          credentials: undefined as unknown,
        }) as unknown as MatrixClient,
    );
    await expect(
      startMatrixAdapter({
        homeserverUrl: 'https://hs',
        auth: { user: 'kaytoo', password: 'wrong' },
        matrixSdkLevel: 'ERROR',
        onEvent: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow(/M_FORBIDDEN/);
  });
});
