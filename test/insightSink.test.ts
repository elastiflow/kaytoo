import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { ChatAddress, ChatPost } from '../src/chat/types.js';
import type { Notifier } from '../src/notify/notifier.js';
import { createMultiInsightSink, createPlatformInsightSink } from '../src/notify/insightSink.js';

function recordingNotifier(): Notifier & { calls: ChatPost[] } {
  const calls: ChatPost[] = [];
  return {
    calls,
    async post(input: ChatPost): Promise<void> {
      calls.push(input);
    },
  };
}

function silentLogger(): Logger & { warns: Array<{ obj: unknown; msg: string }> } {
  const warns: Array<{ obj: unknown; msg: string }> = [];
  const log = {
    warns,
    warn: (obj: unknown, msg: string) => warns.push({ obj, msg }),
    info: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger & { warns: Array<{ obj: unknown; msg: string }> };
  return log;
}

describe('createPlatformInsightSink', () => {
  it('delegates to the notifier with a fixed ChatAddress', async () => {
    const notifier = recordingNotifier();
    const address: ChatAddress = { platform: 'matrix', channelId: '!room:example.com' };
    const sink = createPlatformInsightSink(notifier, address);

    await sink.postInsight('hello');

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toEqual({ address, text: 'hello' });
  });

  it('propagates notifier rejections', async () => {
    const notifier: Notifier = {
      post: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const sink = createPlatformInsightSink(notifier, { platform: 'slack', channelId: 'C1' });

    await expect(sink.postInsight('x')).rejects.toThrow('boom');
  });
});

describe('createMultiInsightSink', () => {
  it('fans out to every sink', async () => {
    const a = { postInsight: vi.fn().mockResolvedValue(undefined) };
    const b = { postInsight: vi.fn().mockResolvedValue(undefined) };
    const sink = createMultiInsightSink({ sinks: [a, b], log: silentLogger() });

    await sink.postInsight('msg');

    expect(a.postInsight).toHaveBeenCalledWith('msg');
    expect(b.postInsight).toHaveBeenCalledWith('msg');
  });

  it('continues past a failing sink and logs the rejection', async () => {
    const ok = { postInsight: vi.fn().mockResolvedValue(undefined) };
    const fail = { postInsight: vi.fn().mockRejectedValue(new Error('matrix down')) };
    const log = silentLogger();
    const sink = createMultiInsightSink({ sinks: [fail, ok], log });

    await expect(sink.postInsight('msg')).resolves.toBeUndefined();
    expect(ok.postInsight).toHaveBeenCalled();
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]?.msg).toBe('insight sink failed');
  });

  it('is a no-op with no sinks', async () => {
    const log = silentLogger();
    const sink = createMultiInsightSink({ sinks: [], log });
    await expect(sink.postInsight('msg')).resolves.toBeUndefined();
    expect(log.warns).toHaveLength(0);
  });
});
