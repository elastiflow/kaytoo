import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyAgentIntent, parseIntentLabel } from '../src/agent/prompts/intent.js';
import { getLogger } from '../src/logging/logger.js';
import { useSilentLogging } from './helpers/index.js';

describe('parseIntentLabel', () => {
  it('accepts exact labels', () => {
    expect(parseIntentLabel('FLOW_ANALYTICS')).toBe('FLOW_ANALYTICS');
    expect(parseIntentLabel('TROUBLESHOOTING')).toBe('TROUBLESHOOTING');
    expect(parseIntentLabel('GENERAL_CHAT')).toBe('GENERAL_CHAT');
  });

  it('trims and uses first line and first token', () => {
    expect(parseIntentLabel('  FLOW_ANALYTICS  ')).toBe('FLOW_ANALYTICS');
    expect(parseIntentLabel('TROUBLESHOOTING\nextra line')).toBe('TROUBLESHOOTING');
    expect(parseIntentLabel('GENERAL_CHAT trailing prose')).toBe('GENERAL_CHAT');
  });

  it('returns null for invalid labels', () => {
    expect(parseIntentLabel('')).toBeNull();
    expect(parseIntentLabel('UNKNOWN')).toBeNull();
    expect(parseIntentLabel('FLOW_ANALYTICS_EXTRA')).toBeNull();
  });
});

describe('classifyAgentIntent', () => {
  useSilentLogging(beforeEach, afterEach);

  it('uses temperature 0 and maxTokens 16 on the LLM client', async () => {
    const log = getLogger({ component: 'test' });
    const chatCompletions = vi.fn().mockResolvedValue({ content: 'GENERAL_CHAT' });
    const intent = await classifyAgentIntent({
      llm: { chatCompletions, summarizeFindings: vi.fn() },
      userText: 'what commands does this bot support?',
      log,
    });

    expect(intent).toBe('GENERAL_CHAT');
    expect(chatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0, maxTokens: 16 }),
    );
  });

  it('falls back to FLOW_ANALYTICS when the label is invalid', async () => {
    const log = getLogger({ component: 'test' });
    const intent = await classifyAgentIntent({
      llm: { chatCompletions: vi.fn().mockResolvedValue({ content: 'GIBBERISH' }), summarizeFindings: vi.fn() },
      userText: 'hi',
      log,
    });
    expect(intent).toBe('FLOW_ANALYTICS');
  });

  it('falls back when the LLM request fails', async () => {
    const log = getLogger({ component: 'test' });
    const intent = await classifyAgentIntent({
      llm: { chatCompletions: vi.fn().mockRejectedValue(new Error('network')), summarizeFindings: vi.fn() },
      userText: 'hi',
      log,
    });
    expect(intent).toBe('FLOW_ANALYTICS');
  });

  it('truncates very long user text before classification', async () => {
    const log = getLogger({ component: 'test' });
    const long = 'x'.repeat(2500);
    const chatCompletions = vi.fn().mockResolvedValue({ content: 'GENERAL_CHAT' });
    await classifyAgentIntent({
      llm: { chatCompletions, summarizeFindings: vi.fn() },
      userText: long,
      log,
    });
    const msgs = (chatCompletions.mock.calls[0]![0] as { messages: Array<{ role?: string; content?: string }> })
      .messages;
    const userMsg = msgs.find((m) => m.role === 'user')?.content;
    expect(userMsg).toContain('[truncated]');
    expect(userMsg!.length).toBeLessThan(long.length);
  });
});
