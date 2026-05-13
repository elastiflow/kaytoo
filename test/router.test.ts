import { describe, expect, it } from 'vitest';
import { ChatRouter } from '../src/chat/router.js';
import type { ChatEvent } from '../src/chat/types.js';
import type { Notifier } from '../src/notify/notifier.js';
import type { AgentRuntime } from '../src/agent/runtime.js';

describe('ChatRouter', () => {
  it('handles help command without invoking agent', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        throw new Error('agent should not be called');
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };

    const router = new ChatRouter({
      notifier,
      agent,
      status: async () => 'ok',
    });

    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'help',
      ts: '1',
    });

    expect(posts.lines.length).toBe(1);
    expect(posts.lines[0]).toMatch(/Kaytoo commands/i);
  });

  it('routes non-command text to agent and posts reply', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        return { text: 'agent reply' };
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };

    const router = new ChatRouter({
      notifier,
      agent,
      status: async () => 'ok',
    });

    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'what happened?',
      ts: '1',
    });

    expect(posts.lines).toEqual(['agent reply']);
  });

  it('skips stale chat when ingestOpenedAtMs set', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        return { text: 'should not run' };
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const ingestOpenedAtMs = Date.parse('2024-06-01T12:00:00.000Z');
    const router = new ChatRouter({
      notifier,
      agent,
      status: async () => 'ok',
      ingestOpenedAtMs,
    });

    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'old backlog',
      ts: '2024-06-01T11:00:00.000Z',
    });

    expect(posts.lines).toEqual([]);
  });

  it('routes chat at or after ingest open', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        return { text: 'fresh reply' };
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const ingestOpenedAtMs = Date.parse('2024-06-01T12:00:00.000Z');
    const router = new ChatRouter({
      notifier,
      agent,
      status: async () => 'ok',
      ingestOpenedAtMs,
    });

    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'new question',
      ts: '2024-06-01T12:00:10.000Z',
    });

    expect(posts.lines).toEqual(['fresh reply']);
  });

  it('does not filter when ts unparseable', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        return { text: 'parsed anyway' };
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const router = new ChatRouter({
      notifier,
      agent,
      status: async () => 'ok',
      ingestOpenedAtMs: Date.now(),
    });

    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'hello',
      ts: 'bogus-ts',
    });

    expect(posts.lines).toEqual(['parsed anyway']);
  });

  it('does not reject when agent.respond throws', async () => {
    const notifier: Notifier = { async post() {} };
    const agent: AgentRuntime = {
      async respond() {
        throw new Error('boom');
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const router = new ChatRouter({ notifier, agent, status: async () => 'ok' });
    await expect(
      router.handleEvent({
        type: 'message',
        platform: 'slack',
        address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
        user: { id: 'U1' },
        text: 'hello',
        ts: '1',
      }),
    ).resolves.toBeUndefined();
  });

  it('reset clears conversation via agent', async () => {
    const posts = { lines: [] as string[] };
    const resetCalls = { count: 0 };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        return { text: 'noop' };
      },
      async resetConversation() {
        resetCalls.count += 1;
      },
      async getConversationDebug() {
        return '';
      },
    };

    const router = new ChatRouter({ notifier, agent, status: async () => 'ok' });
    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'reset',
      ts: '1',
    });

    expect(resetCalls.count).toBe(1);
    expect(posts.lines[0]).toMatch(/cleared/i);
  });

  it('handles status command', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        throw new Error('no');
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const router = new ChatRouter({ notifier, agent, status: async () => 'all systems nominal' });
    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'status',
      ts: '1',
    });
    expect(posts.lines).toEqual(['all systems nominal']);
  });

  it('handles summarize command', async () => {
    const posts = { lines: [] as string[] };
    const notifier: Notifier = {
      async post(input) {
        posts.lines = [...posts.lines, input.text];
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        throw new Error('no');
      },
      async resetConversation() {},
      async getConversationDebug() {
        return 'thread preview';
      },
    };
    const router = new ChatRouter({ notifier, agent, status: async () => 'ok' });
    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'summarize',
      ts: '1',
    });
    expect(posts.lines).toEqual(['thread preview']);
  });

  it('ignores empty message text', async () => {
    const notifier: Notifier = { async post() {} };
    const agent: AgentRuntime = {
      async respond() {
        throw new Error('no');
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const router = new ChatRouter({ notifier, agent, status: async () => 'ok' });
    await router.handleEvent({
      type: 'message',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: '   ',
      ts: '1',
    });
  });

  it('ignores non-message events', async () => {
    const notifier: Notifier = { async post() {} };
    const agent: AgentRuntime = {
      async respond() {
        throw new Error('no');
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const router = new ChatRouter({ notifier, agent, status: async () => 'ok' });
    await router.handleEvent({
      type: 'typing',
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'x',
      ts: '1',
    } as unknown as ChatEvent);
  });

  it('logs non-Error failures in handleEvent', async () => {
    const notifier: Notifier = {
      async post() {
        throw 'string-throw';
      },
    };
    const agent: AgentRuntime = {
      async respond() {
        return { text: 'hi' };
      },
      async resetConversation() {},
      async getConversationDebug() {
        return '';
      },
    };
    const router = new ChatRouter({ notifier, agent, status: async () => 'ok' });
    await expect(
      router.handleEvent({
        type: 'message',
        platform: 'slack',
        address: { platform: 'slack', channelId: 'C1', threadId: 'T1' },
        user: { id: 'U1' },
        text: 'hello',
        ts: '1',
      }),
    ).resolves.toBeUndefined();
  });
});

