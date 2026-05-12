import { describe, expect, it, vi } from 'vitest';
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
    const sink = createMultiInsightSink({ sinks: [a, b] });

    await sink.postInsight('msg');

    expect(a.postInsight).toHaveBeenCalledWith('msg');
    expect(b.postInsight).toHaveBeenCalledWith('msg');
  });

  it('resolves when at least one sink succeeds (inner notifier owns failure logging)', async () => {
    const ok = { postInsight: vi.fn().mockResolvedValue(undefined) };
    const fail = { postInsight: vi.fn().mockRejectedValue(new Error('matrix down')) };
    const sink = createMultiInsightSink({ sinks: [fail, ok] });

    await expect(sink.postInsight('msg')).resolves.toBeUndefined();
    expect(ok.postInsight).toHaveBeenCalled();
  });

  it('rethrows the single reason when only one sink is configured and it fails', async () => {
    const fail = { postInsight: vi.fn().mockRejectedValue(new Error('matrix down')) };
    const sink = createMultiInsightSink({ sinks: [fail] });
    await expect(sink.postInsight('msg')).rejects.toThrow('matrix down');
  });

  it('rejects with AggregateError when every sink fails', async () => {
    const a = { postInsight: vi.fn().mockRejectedValue(new Error('a down')) };
    const b = { postInsight: vi.fn().mockRejectedValue(new Error('b down')) };
    const sink = createMultiInsightSink({ sinks: [a, b] });

    await expect(sink.postInsight('msg')).rejects.toBeInstanceOf(AggregateError);
  });

  it('is a no-op with no sinks', async () => {
    const sink = createMultiInsightSink({ sinks: [] });
    await expect(sink.postInsight('msg')).resolves.toBeUndefined();
  });
});
