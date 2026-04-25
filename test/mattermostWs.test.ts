import { describe, expect, it, vi } from 'vitest';
import { startMattermostAdapter, type MattermostWsCtor } from '../src/chat/adapters/mattermost.js';
import type { ChatEvent } from '../src/chat/types.js';

type EvFn = (e: { data: string }) => void;

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => queueMicrotask(() => r()));
}

class MockWebSocket {
  static last: MockWebSocket | null = null;
  readonly url: string;
  private readonly listeners = new Map<string, EvFn[]>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.last = this;
    queueMicrotask(() => {
      for (const fn of this.listeners.get('open') ?? []) fn({} as never);
    });
  }

  addEventListener(type: string, fn: unknown): void {
    if (typeof fn !== 'function') return;
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...arr, fn as EvFn]);
  }

  removeEventListener(type: string, fn: unknown): void {
    if (typeof fn !== 'function') return;
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((f) => f !== fn),
    );
  }

  send(data: string): void {
    const o = JSON.parse(data) as { action?: string };
    if (o.action === 'authentication_challenge') {
      queueMicrotask(() => {
        for (const fn of this.listeners.get('message') ?? []) {
          fn({ data: JSON.stringify({ status: 'OK' }) });
        }
      });
    }
  }

  emitPosted(payload: { post: Record<string, unknown> }): void {
    const body = JSON.stringify({
      event: 'posted',
      data: JSON.stringify(payload),
    });
    for (const fn of this.listeners.get('message') ?? []) {
      fn({ data: body });
    }
  }

  close(): void {
    for (const fn of this.listeners.get('close') ?? []) fn({} as never);
  }
}

describe('startMattermostAdapter websocket', () => {
  it('authenticates then forwards posted events for the configured channel', async () => {
    MockWebSocket.last = null;
    const onEvent = vi.fn<(evt: ChatEvent) => Promise<void>>().mockResolvedValue(undefined);

    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 'tok',
      channelId: 'ch1',
      onEvent,
      wsFactory: MockWebSocket as unknown as MattermostWsCtor,
    });

    await flushMicrotasks();
    expect(MockWebSocket.last).toBeTruthy();
    const ws = MockWebSocket.last!;
    expect(ws.url.startsWith('wss://')).toBe(true);
    expect(ws.url).toContain('/api/v4/websocket');

    await flushMicrotasks();
    ws.emitPosted({
      post: {
        id: 'p1',
        channel_id: 'ch1',
        user_id: 'u1',
        message: 'hello',
        create_at: 1_700_000_000_000,
      },
    });
    await flushMicrotasks();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0].text).toBe('hello');
    expect(onEvent.mock.calls[0]![0].address.threadId).toBe('p1');

    stop();
  });

  it('uses root_id as thread anchor for replies', async () => {
    MockWebSocket.last = null;
    const onEvent = vi.fn<(evt: ChatEvent) => Promise<void>>().mockResolvedValue(undefined);

    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 'tok',
      channelId: 'ch1',
      onEvent,
      wsFactory: MockWebSocket as unknown as MattermostWsCtor,
    });

    await flushMicrotasks();
    const ws = MockWebSocket.last!;
    await flushMicrotasks();

    ws.emitPosted({
      post: {
        id: 'p-reply',
        root_id: 'p-root',
        channel_id: 'ch1',
        user_id: 'u1',
        message: 'in thread',
        create_at: 1_700_000_000_000,
      },
    });
    await flushMicrotasks();

    expect(onEvent.mock.calls[0]![0].address.threadId).toBe('p-root');
    stop();
  });

  it('ignores posts from the bot user when botUserId is set', async () => {
    MockWebSocket.last = null;
    const onEvent = vi.fn<(evt: ChatEvent) => Promise<void>>().mockResolvedValue(undefined);

    const { stop } = startMattermostAdapter({
      baseUrl: 'https://mm.example',
      token: 'tok',
      channelId: 'ch1',
      botUserId: 'bot1',
      onEvent,
      wsFactory: MockWebSocket as unknown as MattermostWsCtor,
    });

    await flushMicrotasks();
    const ws = MockWebSocket.last!;
    await flushMicrotasks();

    ws.emitPosted({
      post: {
        id: 'p2',
        channel_id: 'ch1',
        user_id: 'bot1',
        message: 'self',
        create_at: 1_700_000_000_000,
      },
    });
    await flushMicrotasks();

    expect(onEvent).not.toHaveBeenCalled();
    stop();
  });
});
