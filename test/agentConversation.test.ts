import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/config.js';
import { minimalAgentEnv, mockOpenAiChatCompletionResponse, useAgentRuntimeTestHooks } from './helpers/index.js';

vi.mock('../src/agent/tools/index.js', () => ({
  createToolRegistry: vi.fn(async () => ({
    listTools: () => [],
    call: async () => ({ name: 'noop', ok: true, result: {} }),
  })),
}));

describe('createAgentRuntime conversation store', () => {
  useAgentRuntimeTestHooks(beforeEach, afterEach);

  it('persists thread turns and supports reset + debug', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-agent-'));
    const storePath = join(dir, 'conv.json');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockOpenAiChatCompletionResponse(JSON.stringify({ reply: 'hello-back' }))),
    );

    const { createAgentRuntime } = await import('../src/agent/runtime.js');
    const base = getConfig(minimalAgentEnv());
    const cfg = { ...base, conversation: { ...base.conversation, storePath } };

    const agent = await createAgentRuntime({ config: cfg });
    await agent.respond({
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: '1.2' },
      user: { id: 'U1' },
      text: 'ping',
      ts: '1',
    });

    const dbg = await agent.getConversationDebug({
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: '1.2' },
    });
    expect(dbg).toMatch(/ping/);
    expect(dbg).toMatch(/hello-back/);

    await agent.resetConversation({ platform: 'slack', address: { platform: 'slack', channelId: 'C1', threadId: '1.2' } });
    const cleared = await agent.getConversationDebug({
      platform: 'slack',
      address: { platform: 'slack', channelId: 'C1', threadId: '1.2' },
    });
    expect(cleared).toMatch(/no stored conversation/i);

    await rm(dir, { recursive: true });
  });
});
