import { describe, expect, it } from 'vitest';
import { normalizeSlackEventCallback } from '../src/chat/adapters/slackSocket.js';

describe('normalizeSlackEventCallback', () => {
  it('normalizes message event callback', () => {
    const evt = normalizeSlackEventCallback({
      type: 'event_callback',
      team_id: 'T1',
      event: {
        type: 'message',
        text: 'hi',
        user: 'U1',
        channel: 'C1',
        ts: '123.45',
      },
    });

    expect(evt?.platform).toBe('slack');
    expect(evt?.type).toBe('message');
    expect(evt?.address.channelId).toBe('C1');
    expect(evt?.user.id).toBe('U1');
  });

  it('ignores bot messages', () => {
    const evt = normalizeSlackEventCallback({
      type: 'event_callback',
      event: {
        type: 'message',
        text: 'hi',
        user: 'U1',
        channel: 'C1',
        ts: '123.45',
        bot_id: 'B1',
      },
    });
    expect(evt).toBeNull();
  });
});

