import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/config.js';
import {
  minimalAgentEnv,
  mockOpenAiChatCompletionResponse,
  useAgentRuntimeTestHooks,
} from './helpers/index.js';

const toolCallSpy = vi.fn(async () => ({ name: 'searchFlows', ok: true, result: { ok: true } }));
const listToolsSpy = vi.fn(() => [{ name: 'searchFlows', description: 'x', argsSchema: {} }]);

vi.mock('../src/agent/tools/index.js', () => ({
  createToolRegistry: vi.fn(async () => ({
    listTools: listToolsSpy,
    call: toolCallSpy,
  })),
}));

function mkCfg() {
  return getConfig(minimalAgentEnv());
}

async function mkAgent() {
  const { createAgentRuntime } = await import('../src/agent/runtime.js');
  return createAgentRuntime({ config: mkCfg() });
}

function llmResp(content: string) {
  return mockOpenAiChatCompletionResponse(content);
}

/** Prepended to every agent `respond` because `runAgentLoop` classifies intent first. */
function intentFlow() {
  return llmResp('FLOW_ANALYTICS');
}

describe('agent runtime tool-call parsing + routing', () => {
  useAgentRuntimeTestHooks(beforeEach, afterEach);

  it('executes tool calls from code-fenced JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(intentFlow())
        .mockResolvedValueOnce(
          llmResp('```json\n{"tool_calls":[{"name":"searchFlows","args":{"query":{"match_all":{}}}}]}\n```'),
        )
        .mockResolvedValueOnce(llmResp('{"reply":"ok"}')),
    );

    const agent = await mkAgent();
    const res = await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T1' },
      user: { id: 'U1' },
      text: 'List flows to rare external destinations.',
      ts: '1',
    });

    expect(toolCallSpy).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('ok');
  });

  it('executes tool calls from leading prose + embedded JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(intentFlow())
        .mockResolvedValueOnce(
          llmResp(
            'Sure.\nHere you go:\n{"tool_calls":[{"name":"searchFlows","args":{"query":{"match_all":{}}}}]}\nThanks.',
          ),
        )
        .mockResolvedValueOnce(llmResp('{"reply":"ok"}')),
    );

    const agent = await mkAgent();
    const res = await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T2' },
      user: { id: 'U1' },
      text: 'What is the pod name for each of the top 5 talkers?',
      ts: '1',
    });

    expect(toolCallSpy).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('ok');
  });

  it('executes tool calls when returned as a double-encoded reply string', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(intentFlow())
        .mockResolvedValueOnce(
          llmResp(
            JSON.stringify({
              reply: JSON.stringify({ tool_calls: [{ name: 'searchFlows', args: { query: { match_all: {} } } }] }),
            }),
          ),
        )
        .mockResolvedValueOnce(llmResp('{"reply":"ok"}')),
    );

    const agent = await mkAgent();
    const res = await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T3' },
      user: { id: 'U1' },
      text: 'Rank namespaces by egress bytes.',
      ts: '1',
    });

    expect(toolCallSpy).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('ok');
  });

  it('marks classic troubleshooting questions as troubleshooting intent in the prompt', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(llmResp('TROUBLESHOOTING'))
      .mockResolvedValueOnce(llmResp('{"reply":"ok"}'));
    vi.stubGlobal('fetch', fetchSpy);

    const agent = await mkAgent();
    await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T4' },
      user: { id: 'U1' },
      text: 'BGP troubleshooting: why is my session flapping?',
      ts: '1',
    });

    const body = (fetchSpy.mock.calls[1]?.[1] as { body?: string } | undefined)?.body ?? '';
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> };
    const system = parsed.messages?.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('Intent: TROUBLESHOOTING');
  });

  it('repairs malformed tool_calls JSON and continues', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(intentFlow())
        .mockResolvedValueOnce(
          llmResp(
            JSON.stringify({
              reply: '{"tool_calls":[{"name":"searchFlows","args":{"query":{"match_all":{}}}}', // missing closing }]}
            }),
          ),
        )
        .mockResolvedValueOnce(
          llmResp('{"tool_calls":[{"name":"searchFlows","args":{"query":{"match_all":{}}}}]}'),
        )
        .mockResolvedValueOnce(llmResp('{"reply":"ok"}')),
    );

    const agent = await mkAgent();
    const res = await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T5' },
      user: { id: 'U1' },
      text: 'Anything.',
      ts: '1',
    });

    expect(toolCallSpy).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('ok');
    expect(res.text.toLowerCase()).not.toContain('tool_calls');
  });

  it('executes tool calls when tool_calls is a stringified JSON object', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(intentFlow())
        .mockResolvedValueOnce(
          llmResp(
            JSON.stringify({
              tool_calls: JSON.stringify([{ name: 'searchFlows', args: { query: { match_all: {} } } }]),
            }),
          ),
        )
        .mockResolvedValueOnce(llmResp('{"reply":"ok"}')),
    );

    const agent = await mkAgent();
    const res = await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T6' },
      user: { id: 'U1' },
      text: 'List flows.',
      ts: '1',
    });

    expect(toolCallSpy).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('ok');
  });

  it('compresses very long multi-line plain-text replies', async () => {
    const lines = Array.from(
      { length: 15 },
      (_, i) => `Line ${i} has enough words to exercise the reply compression path in the agent loop.`,
    );
    const bigReply = lines.join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(intentFlow()).mockResolvedValueOnce(llmResp(JSON.stringify({ reply: bigReply }))),
    );

    const agent = await mkAgent();
    const res = await agent.respond({
      platform: 'e2e',
      address: { platform: 'e2e', channelId: 'C1', threadId: 'T7' },
      user: { id: 'U1' },
      text: 'Give me a verbose answer.',
      ts: '1',
    });

    expect(res.text).toContain('truncated');
    expect(res.text.split('\n').length).toBeLessThanOrEqual(11);
  });
});

