import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { SlackNotifier } from '../src/notify/slack.js';
import { createSlackChatNotifier } from '../src/notify/slackNotifier.js';
import { createMatrixNotifier } from '../src/notify/matrixNotifier.js';
import { createMattermostNotifier } from '../src/notify/mattermostNotifier.js';

afterEach(() => vi.unstubAllGlobals());

describe('slackChatNotifier', () => {
  it('rejects non-slack platform', async () => {
    const slack: SlackNotifier = { postMessage: vi.fn().mockResolvedValue(undefined) };
    const n = createSlackChatNotifier({ slack, defaultChannelId: 'D1' });
    await expect(
      n.post({ address: { platform: 'matrix', channelId: '!1:x' }, text: 'x' }),
    ).rejects.toThrow(/Slack notifier cannot post to platform=matrix/);
  });

  it('forwards threadTs and falls back to defaultChannelId', async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const n = createSlackChatNotifier({ slack: { postMessage } as SlackNotifier, defaultChannelId: 'D1' });
    await n.post({
      address: { platform: 'slack', channelId: 'C9', threadId: '111.222' },
      text: 'hi',
    });
    expect(postMessage).toHaveBeenCalledWith({ channel: 'C9', text: 'hi', threadTs: '111.222' });
    await n.post({ address: { platform: 'slack', channelId: undefined as unknown as string }, text: 'no' });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'D1', text: 'no' }));
  });
});

describe('matrixNotifier', () => {
  it('rejects non-matrix platform', async () => {
    const n = createMatrixNotifier({ sendHtmlMessage: vi.fn() } as unknown as MatrixClient);
    await expect(n.post({ address: { platform: 'slack', channelId: 'C1' }, text: 'x' })).rejects.toThrow(
      /Matrix notifier cannot post to platform=slack/,
    );
  });

  it('sendHtmlMessage arity for main vs thread', async () => {
    const sendHtmlMessage = vi.fn().mockResolvedValue(undefined);
    const n = createMatrixNotifier({ sendHtmlMessage } as unknown as MatrixClient);
    await n.post({ address: { platform: 'matrix', channelId: '!r', threadId: 'main' }, text: '**a**' });
    expect(sendHtmlMessage).toHaveBeenLastCalledWith(
      '!r',
      expect.any(String),
      expect.stringContaining('<strong>a</strong>'),
    );
    await n.post({ address: { platform: 'matrix', channelId: '!r', threadId: '$e' }, text: '**b**' });
    expect(sendHtmlMessage).toHaveBeenLastCalledWith(
      '!r',
      '$e',
      expect.any(String),
      expect.stringContaining('<strong>b</strong>'),
    );
  });
});

describe('mattermostNotifier', () => {
  it('rejects non-mattermost platform', async () => {
    const n = createMattermostNotifier({ baseUrl: 'https://mm', token: 't' });
    await expect(n.post({ address: { platform: 'slack', channelId: 'C1' }, text: 'x' })).rejects.toThrow(
      /Mattermost notifier cannot post to platform=slack/,
    );
  });

  it('POST /api/v4/posts; throws on non-OK', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, statusText: 'Created', text: async () => '' })
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad', text: async () => 'nope' })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Err',
        text: async () => {
          throw new Error('read fail');
        },
      });
    vi.stubGlobal('fetch', fetchMock);
    const n = createMattermostNotifier({ baseUrl: 'https://mm.example', token: 'tok' });
    await n.post({ address: { platform: 'mattermost', channelId: 'ch1', threadId: 'root1' }, text: 'm' });
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toMatchObject({
      channel_id: 'ch1',
      message: 'm',
      root_id: 'root1',
    });
    await expect(n.post({ address: { platform: 'mattermost', channelId: 'ch1' }, text: 'x' })).rejects.toThrow(
      /Mattermost post failed: 400 Bad/,
    );
    await expect(n.post({ address: { platform: 'mattermost', channelId: 'ch1' }, text: 'x' })).rejects.toThrow(
      /Mattermost post failed: 500 Err/,
    );
  });
});
