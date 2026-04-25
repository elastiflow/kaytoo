import { describe, expect, it } from 'vitest';
import { buildAgentPrompt } from '../src/agent/prompts/agentPrompt.js';

const noopTool = { name: 'noop', description: 'noop', argsSchema: {} };

describe('buildAgentPrompt', () => {
  it('FLOW_ANALYTICS: contract, flow playbooks, no troubleshooting steering', () => {
    const msgs = buildAgentPrompt({
      tools: [noopTool],
      turns: [{ role: 'user', content: 'show top talkers in default' }],
      toolResults: [],
      intent: 'FLOW_ANALYTICS',
    });
    expect(msgs[0]?.role).toBe('system');
    const system = msgs[0]?.content ?? '';

    expect(system).toContain('Output MUST be a single top-level JSON object');
    expect(system).toContain('{"tool_calls"');
    expect(system).toContain('{"reply"');
    expect(system).toContain('Never put JSON inside a quoted string');
    expect(system).toContain('Intent: FLOW_ANALYTICS');
    expect(system).toContain('Flow analytics playbooks:');
    expect(system).toContain('topTalkersByBytes');
    expect(system).not.toContain('Flow-helpful vs flow-not-helpful steering for classic troubleshooting:');
    expect(system).not.toMatch(/[×…—\u00a0]/);
  });

  it('TROUBLESHOOTING: steering + flow stub, no flow playbook header', () => {
    const msgs = buildAgentPrompt({
      tools: [noopTool],
      turns: [{ role: 'user', content: 'BGP flap' }],
      toolResults: [],
      intent: 'TROUBLESHOOTING',
    });
    const system = msgs[0]?.content ?? '';
    expect(system).toContain('Intent: TROUBLESHOOTING');
    expect(system).toContain('Flow-helpful vs flow-not-helpful steering for classic troubleshooting:');
    expect(system).toContain('Flow data (supporting evidence only):');
    expect(system).not.toContain('Flow analytics playbooks:');
  });

  it('GENERAL_CHAT: general playbooks anchor', () => {
    const msgs = buildAgentPrompt({
      tools: [noopTool],
      turns: [{ role: 'user', content: 'hello' }],
      toolResults: [],
      intent: 'GENERAL_CHAT',
    });
    const system = msgs[0]?.content ?? '';
    expect(system).toContain('Intent: GENERAL_CHAT');
    expect(system).toContain('Meta/help:');
    expect(system).not.toContain('Flow analytics playbooks:');
  });
});
