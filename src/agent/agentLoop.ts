import type { Logger } from 'pino';
import { withDurationMs } from '../logging/logger.js';
import { isRecord } from '../util/guards.js';
import { parseLenientOrNull } from '../util/json.js';
import type { ChatMessage, LlmClient } from '../llm/types.js';
import type { ConversationTurn } from '../storage/conversationStore.js';
import type { ToolRegistry, ToolResult } from './tools/types.js';
import { buildAgentPrompt } from './prompts/agentPrompt.js';
import { AGENT_JSON_TOOL_CALLS_SINGLE_OBJECT } from './prompts/intentMetadata.js';
import { classifyAgentIntent } from './prompts/intent.js';

export async function runAgentLoop(opts: {
  llm: LlmClient;
  tools: ToolRegistry;
  turns: ConversationTurn[];
  log: Logger;
  summary?: string;
}): Promise<string> {
  const lastUser = [...opts.turns].reverse().find((t) => t.role === 'user')?.content ?? '';
  const intent = await withDurationMs(opts.log, 'agent.intent_classify', () =>
    classifyAgentIntent({ llm: opts.llm, userText: lastUser, log: opts.log }),
  );

  const step = async (
    toolResults: ToolResult[],
    remaining: number,
    repairAttempted: boolean,
  ): Promise<string> => {
    if (remaining <= 0) return 'I ran out of steps while investigating. Try narrowing the question.';

    const messages = buildAgentPrompt({
      tools: opts.tools.listTools(),
      turns: opts.turns,
      toolResults: toolResults,
      intent,
      ...(opts.summary ? { summary: opts.summary } : {}),
    });

    const { content } = await withDurationMs(opts.log, 'agent.chat_completions', () =>
      opts.llm.chatCompletions({ messages, temperature: 0.2 }),
    );
    const parsed = parseLenientOrNull({ raw: content, log: opts.log, context: 'agent.response_parse' });
    if (!isRecord(parsed)) {
      if (looksLikeToolCalls(content) && !repairAttempted) {
        const repaired = await repairInvalidToolCalls({ llm: opts.llm, messages, badText: content });
        const repairedParsed = parseLenientOrNull({ raw: repaired, log: opts.log, context: 'agent.response_repair_parse' });
        if (isRecord(repairedParsed)) {
          const toolCalls2 = normalizeToolCalls(repairedParsed['tool_calls'], opts.log, 'agent.tool_calls_repair_parse');
          if (Array.isArray(toolCalls2) && toolCalls2.length > 0) {
            const next = await runToolCalls({ tools: opts.tools, toolCalls: toolCalls2, log: opts.log });
            return await step(next, remaining - 1, true);
          }
        }
      }
      if (looksLikeToolCalls(content)) return invalidToolCallsReply();
      return content;
    }

    const reply = parsed['reply'];
    const toolCalls = normalizeToolCalls(parsed['tool_calls'], opts.log, 'agent.tool_calls_parse');

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const next = await runToolCalls({ tools: opts.tools, toolCalls, log: opts.log });
      return await step(next, remaining - 1, repairAttempted);
    }

    if (typeof reply === 'string') {
      const embedded = extractToolCallsFromText(reply, opts.log, 'agent.reply_parse');
      if (embedded && embedded.length > 0) {
        const next = await runToolCalls({ tools: opts.tools, toolCalls: embedded, log: opts.log });
        return await step(next, remaining - 1, repairAttempted);
      }
      if (looksLikeToolCalls(reply) && !repairAttempted) {
        const repaired = await repairInvalidToolCalls({ llm: opts.llm, messages, badText: reply });
        const repairedParsed = parseLenientOrNull({ raw: repaired, log: opts.log, context: 'agent.reply_repair_parse' });
        if (isRecord(repairedParsed)) {
          const toolCalls2 = normalizeToolCalls(
            repairedParsed['tool_calls'],
            opts.log,
            'agent.tool_calls_reply_repair_parse',
          );
          if (Array.isArray(toolCalls2) && toolCalls2.length > 0) {
            const next = await runToolCalls({ tools: opts.tools, toolCalls: toolCalls2, log: opts.log });
            return await step(next, remaining - 1, true);
          }
        }
      }
      if (looksLikeToolCalls(reply)) return invalidToolCallsReply();
      return toolResults.length === 0 ? compressToMaxLines(reply, 10) : reply;
    }
    return content;
  };

  return await step([], 6, false);
}

function looksLikeToolCalls(s: string): boolean {
  return /"tool_calls"\s*:/.test(s);
}

function invalidToolCallsReply(): string {
  return 'Tool-call JSON was invalid; please re-ask with fewer constraints.';
}

async function repairInvalidToolCalls(opts: { llm: LlmClient; messages: ChatMessage[]; badText: string }): Promise<string> {
  const { content } = await opts.llm.chatCompletions({
    messages: [
      ...opts.messages,
      {
        role: 'user',
        content:
          'Your last message contained invalid tool-call JSON. Output ONLY one valid top-level JSON object. ' +
          `If you need tools, output ${AGENT_JSON_TOOL_CALLS_SINGLE_OBJECT}. ` +
          'No prose, no code fences, no nested/quoted JSON.\n\nInvalid content:\n' +
          opts.badText.slice(0, 1200),
      },
    ],
    temperature: 0.0,
  });
  return content.trim();
}

function normalizeToolCalls(v: unknown, log: Logger, context: string): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  const parsed = parseLenientOrNull({ raw: v, log, context });
  if (Array.isArray(parsed)) return parsed as unknown[];
  if (isRecord(parsed) && Array.isArray(parsed['tool_calls'])) return parsed['tool_calls'] as unknown[];
  return null;
}

function extractToolCallsFromText(raw: string, log: Logger, context: string): unknown[] | null {
  if (!looksLikeToolCalls(raw)) return null;
  const parsed = parseLenientOrNull({ raw, log, context });
  if (isRecord(parsed) && Array.isArray(parsed['tool_calls'])) return parsed['tool_calls'] as unknown[];
  return null;
}

function compressToMaxLines(text: string, maxLines: number): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/\s+/g, ' '));

  if (maxLines <= 0) return '';
  if (lines.length <= maxLines) return lines.join('\n');

  const head = lines.slice(0, Math.max(1, maxLines - 1));
  return [...head, '... (truncated; share vendor/platform + timestamps for deeper triage)'].join('\n');
}

async function runToolCalls(opts: {
  tools: ToolRegistry;
  toolCalls: unknown[];
  log: Logger;
}): Promise<ToolResult[]> {
  const picked = opts.toolCalls
    .map((c): { name: string; args: Record<string, unknown> } | null => {
      if (!isRecord(c)) return null;
      const name = c['name'];
      const args = c['args'];
      if (typeof name !== 'string') return null;
      if (!isRecord(args)) return null;
      return { name, args };
    })
    .filter((v): v is { name: string; args: Record<string, unknown> } => v !== null)
    .slice(0, 3);

  return await Promise.all(
    picked.map(async (t) => {
      const t0 = Date.now();
      const res = await opts.tools.call(t);
      opts.log.info({ tool: t.name, ok: res.ok, durationMs: Date.now() - t0 }, 'agent tool finished');
      return res;
    }),
  );
}
