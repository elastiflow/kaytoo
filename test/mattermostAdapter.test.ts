import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/util/sleep.js', () => ({ sleepMs: vi.fn().mockResolvedValue(undefined) }));

import { startMattermostAdapter } from '../src/chat/adapters/mattermost.js';

class MemWs {
  static last: MemWs | undefined;
  url: string;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string) {
    this.url = url;
    MemWs.last = this;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    if (type === 'open') queueMicrotask(() => (listener as (e: Event) => void)(new Event('open')));
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(_data: string): void {}

  close(): void {
    for (const fn of [...(this.listeners.get('close') ?? [])]) (fn as (e: Event) => void)(new Event('close'));
  }

  msg(data: unknown): void {
    const ev = { data } as MessageEvent;
    for (const fn of [...(this.listeners.get('message') ?? [])]) (fn as (e: MessageEvent) => void)(ev);
  }

  err(): void {
    for (const fn of [...(this.listeners.get('error') ?? [])]) (fn as (e: Event) => void)(new Event('error'));
  }
}

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(r));
}

async function flushMany(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await flush();
}

describe('startMattermostAdapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connects with https→wss URL, authenticates, emits posted messages', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example/',
      token: 'tok',
      channelId: 'CH1',
      onEvent,
      wsFactory: MemWs as never,
    });
    await flushMany();
    expect(MemWs.last?.url).toMatch(/^wss:\/\//);
    MemWs.last!.msg(JSON.stringify({ status: 'OK' }));
    await flushMany();
    MemWs.last!.msg(
      JSON.stringify({
        event: 'posted',
        data: JSON.stringify({
          post: { id: 'p1', channel_id: 'CH1', message: ' hi ', user_id: 'U1', create_at: 1 },
        }),
      }),
    );
    await flushMany();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'mattermost',
        text: ' hi ',
        address: expect.objectContaining({ channelId: 'CH1', threadId: 'p1' }),
      }),
    );
    stop();
    await flushMany();
  });

  it('uses ws URL for http base', async () => {
    const { stop } = startMattermostAdapter({
      baseUrl: 'http://mm.local',
      token: 't',
      channelId: 'CH',
      onEvent: vi.fn().mockResolvedValue(undefined),
      wsFactory: MemWs as never,
    });
    await flushMany();
    expect(MemWs.last?.url.startsWith('ws://')).toBe(true);
    MemWs.last!.msg(JSON.stringify({ status: 'OK' }));
    await flushMany();
    stop();
    await flushMany();
  });

  it('handshake error rejects connectOnce', async () => {
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 't',
      channelId: 'CH',
      onEvent: vi.fn().mockResolvedValue(undefined),
      wsFactory: MemWs as never,
    });
    await flushMany();
    MemWs.last!.msg(JSON.stringify({ error: 'bad token' }));
    await flushMany();
    stop();
    await flushMany();
  });

  it('websocket error rejects connectOnce', async () => {
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 't',
      channelId: 'CH',
      onEvent: vi.fn().mockResolvedValue(undefined),
      wsFactory: MemWs as never,
    });
    await flushMany();
    MemWs.last!.err();
    await flushMany();
    stop();
    await flushMany();
  });

  it('filters posts: bot user, channel, empty body, missing create_at', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 't',
      channelId: 'CH1',
      botUserId: 'BOT',
      onEvent,
      wsFactory: MemWs as never,
    });
    await flushMany();
    MemWs.last!.msg(JSON.stringify({ status: 'OK' }));
    await flushMany();
    for (const data of [
      { post: { channel_id: 'CH1', message: 'x', create_at: 1, user_id: 'BOT' } },
      { post: { channel_id: 'OTHER', message: 'x', create_at: 1, user_id: 'U' } },
      { post: { channel_id: 'CH1', message: '   ', create_at: 1, user_id: 'U' } },
      { post: { channel_id: 'CH1', message: 'x', user_id: 'U' } },
    ]) {
      MemWs.last!.msg(JSON.stringify({ event: 'posted', data: JSON.stringify(data) }));
      await flushMany();
    }
    expect(onEvent).not.toHaveBeenCalled();
    MemWs.last!.msg(
      JSON.stringify({
        event: 'posted',
        data: { post: { channel_id: 'CH1', message: 'ok', create_at: 2, user_id: 'U2', root_id: '  r1  ' } },
      }),
    );
    await flushMany();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ threadId: '  r1  ' }) }),
    );
    stop();
    await flushMany();
  });

  it('ignores non-posted events and bad envelopes', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 't',
      channelId: 'CH1',
      onEvent,
      wsFactory: MemWs as never,
    });
    await flushMany();
    MemWs.last!.msg(JSON.stringify({ status: 'OK' }));
    await flushMany();
    MemWs.last!.msg(JSON.stringify({ event: 'typing' }));
    MemWs.last!.msg('not-json');
    MemWs.last!.msg(JSON.stringify({ event: 'posted', data: 'not-json' }));
    await flushMany();
    expect(onEvent).not.toHaveBeenCalled();
    stop();
  });

  it('logs when onEvent rejects for a posted message', async () => {
    const onEvent = vi.fn().mockRejectedValue(new Error('handler down'));
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 't',
      channelId: 'CH1',
      onEvent,
      wsFactory: MemWs as never,
    });
    await flushMany();
    MemWs.last!.msg(JSON.stringify({ status: 'OK' }));
    await flushMany();
    MemWs.last!.msg(
      JSON.stringify({
        event: 'posted',
        data: JSON.stringify({ post: { id: 'p', channel_id: 'CH1', message: 'm', create_at: 1, user_id: 'U' } }),
      }),
    );
    await flushMany();
    stop();
  });

  it('uses post id as thread anchor when root_id absent', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 't',
      channelId: 'CH1',
      onEvent,
      wsFactory: MemWs as never,
    });
    await flushMany();
    MemWs.last!.msg(JSON.stringify({ status: 'OK' }));
    await flushMany();
    MemWs.last!.msg(
      JSON.stringify({
        event: 'posted',
        data: JSON.stringify({ post: { id: 'pid', channel_id: 'CH1', message: 'm', create_at: 3, user_id: 'U' } }),
      }),
    );
    await flushMany();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ threadId: 'pid' }) }),
    );
    stop();
  });
});
