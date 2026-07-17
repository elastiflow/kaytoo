import { describe, expect, it } from 'vitest';
import { buildSlackSummaryPrompt } from '../src/llm/prompt.js';

describe('buildSlackSummaryPrompt', () => {
  it('produces system+user messages and user content is JSON', () => {
    const msgs = buildSlackSummaryPrompt([
      {
        id: 'x',
        kind: 'port_scan',
        severity: 'high',
        title: 'Possible port scan',
        summary: 'Example',
        evidence: { foo: 'bar' },
        window: { from: 'a', to: 'b' },
      },
    ]);

    expect(msgs.length).toBe(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toMatch(/Decline ordinary streaming/i);
    expect(msgs[0]?.content).toMatch(/exfiltration/i);
    expect(msgs[1]?.role).toBe('user');
    const payload = JSON.parse(msgs[1]?.content ?? '');
    expect(payload.findings).toHaveLength(1);
  });
});

