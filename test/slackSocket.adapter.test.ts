import { describe, expect, it, vi } from 'vitest';

const socketHoisted = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => unknown>,
}));

vi.mock('@slack/socket-mode', () => ({
  SocketModeClient: vi.fn().mockImplementation(function SocketModeClientMock() {
    return {
      on: vi.fn((event: string, fn: (...args: unknown[]) => unknown) => {
        socketHoisted.handlers[event] = fn;
      }),
      start: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('startSlackSocketAdapter', () => {
  it('registers slack_event handler and forwards normalized messages', async () => {
    vi.resetModules();
    socketHoisted.handlers = {};
    const { SocketModeClient } = await import('@slack/socket-mode');
    const { startSlackSocketAdapter } = await import('../src/chat/adapters/slackSocket.js');

    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = await startSlackSocketAdapter({ appToken: 'xapp', onEvent });

    expect(SocketModeClient).toHaveBeenCalledWith({ appToken: 'xapp' });
    const handler = socketHoisted.handlers['slack_event'];
    if (typeof handler !== 'function') throw new Error('expected slack_event handler');

    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      ack,
      body: {
        type: 'event_callback',
        team_id: 'T9',
        event: {
          type: 'message',
          text: 'hello world',
          user: 'U1',
          channel: 'C1',
          ts: '1.0',
        },
      },
    });

    expect(ack).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message',
        text: 'hello world',
        address: expect.objectContaining({ channelId: 'C1', workspaceId: 'T9' }),
      }),
    );

    await stop();
  });

  it('uses top-level payload when body is missing', async () => {
    vi.resetModules();
    socketHoisted.handlers = {};
    const { startSlackSocketAdapter } = await import('../src/chat/adapters/slackSocket.js');
    const onEvent = vi.fn().mockResolvedValue(undefined);
    await startSlackSocketAdapter({ appToken: 'xapp', onEvent });
    const handler = socketHoisted.handlers['slack_event']!;
    await handler({
      ack: vi.fn(),
      payload: {
        type: 'event_callback',
        event: {
          type: 'message',
          text: 'p',
          user: 'U1',
          channel: 'C1',
          ts: '2.0',
        },
      },
    });
    expect(onEvent).toHaveBeenCalled();
  });
});
