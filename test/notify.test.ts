import { describe, expect, it, vi } from 'vitest';
import { formatFindingsFallback } from '../src/notify/format.js';
import { createMultiNotifier, createPromiseBackedNotifier } from '../src/notify/multiNotifier.js';
import type { Notifier } from '../src/notify/notifier.js';
import { createConsoleInsightSink } from '../src/notify/consoleInsightSink.js';
import type { Logger } from 'pino';

vi.mock('@slack/web-api', () => {
  const postMessage = vi.fn().mockResolvedValue(undefined);
  const WebClient = vi.fn(function (this: unknown, _token: string) {
    return { chat: { postMessage } };
  });
  return { WebClient, __postMessage: postMessage };
});

describe('notify', () => {
  it('formatFindingsFallback returns a friendly message for empty findings', () => {
    expect(formatFindingsFallback([])).toMatch(/no notable network-flow changes/i);
  });

  it('formatFindingsFallback lists top findings and truncates', () => {
    const findings = Array.from({ length: 7 }, (_, i) => ({
      id: `id-${i}`,
      kind: 'port_scan' as const,
      severity: 'low' as const,
      title: `T${i}`,
      summary: `S${i}`,
      evidence: {},
      window: { from: 'a', to: 'b' },
    }));

    const text = formatFindingsFallback(findings);
    expect(text).toContain('Kaytoo: 7 insight(s)');
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(6); // 5 findings + "...and N more"
    expect(text).toContain('...and 2 more');
  });

  it('createSlackNotifier posts messages via WebClient.chat.postMessage', async () => {
    const { createSlackNotifier } = await import('../src/notify/slack.js');
    const slack = createSlackNotifier({ botToken: 'xoxb-test' });

    await slack.postMessage({ channel: 'C1', text: 'hello' });

    const m = (await import('@slack/web-api')) as unknown as {
      WebClient: ReturnType<typeof vi.fn>;
      __postMessage: ReturnType<typeof vi.fn>;
    };

    const WebClient = m.WebClient;
    expect(WebClient).toHaveBeenCalledWith('xoxb-test');
    expect(m.__postMessage).toHaveBeenCalledWith({ channel: 'C1', text: 'hello' });
  });

  it('createSlackNotifier passes thread_ts when threadTs is set', async () => {
    const { createSlackNotifier } = await import('../src/notify/slack.js');
    const slack = createSlackNotifier({ botToken: 'xoxb-test' });
    await slack.postMessage({ channel: 'C1', text: 'in thread', threadTs: '1234.5678' });
    const m = (await import('@slack/web-api')) as unknown as { __postMessage: ReturnType<typeof vi.fn> };
    expect(m.__postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      text: 'in thread',
      thread_ts: '1234.5678',
    });
  });

  it('createMultiNotifier routes posts by platform', async () => {
    const slackPosts = { lines: [] as string[] };
    const slack: Notifier = {
      async post(input) {
        slackPosts.lines = [...slackPosts.lines, input.text];
      },
    };
    const n = createMultiNotifier({ slack });
    await n.post({
      address: { platform: 'slack', channelId: 'C1' },
      text: 'hi',
    });
    expect(slackPosts.lines).toEqual(['hi']);
  });

  it('createMultiNotifier throws when platform has no notifier', async () => {
    const n = createMultiNotifier({ slack: { async post() {} } });
    await expect(
      n.post({ address: { platform: 'matrix', channelId: '!1:example.org' }, text: 'x' }),
    ).rejects.toThrow(/No notifier configured for platform=matrix/);
  });

  it('createPromiseBackedNotifier delegates after promise resolves', async () => {
    const holder: { inner: Notifier | null } = { inner: null };
    const p = Promise.resolve().then(() => holder.inner);
    const wrapped = createPromiseBackedNotifier(p, 'not ready');
    holder.inner = {
      async post(input) {
        expect(input.text).toBe('m');
      },
    };
    await wrapped.post({ address: { platform: 'matrix', channelId: 'R1' }, text: 'm' });
  });

  it('createPromiseBackedNotifier throws when resolved null', async () => {
    const wrapped = createPromiseBackedNotifier(Promise.resolve(null), 'missing');
    await expect(wrapped.post({ address: { platform: 'matrix', channelId: 'R1' }, text: 'x' })).rejects.toThrow(
      'missing',
    );
  });

  it('createConsoleInsightSink logs structured insight_post', async () => {
    const infos = { events: [] as Array<{ obj: unknown; msg: string }> };
    const log = {
      info: (obj: unknown, msg: string) => {
        infos.events = [...infos.events, { obj, msg }];
      },
    } as Logger;
    const sink = createConsoleInsightSink(log);
    await sink.postMessage({ channel: 'console', text: 'hello findings' });
    expect(infos.events).toHaveLength(1);
    expect(infos.events[0]).toEqual({
      obj: { channel: 'console', insightText: 'hello findings' },
      msg: 'insight_post',
    });
  });
});

