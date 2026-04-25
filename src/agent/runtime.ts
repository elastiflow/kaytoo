import type { ChatAddress, ChatPlatform, ChatUser } from '../chat/types.js';
import type { KaytooConfig } from '../config.js';
import { getLogger, logErr, withDurationMs } from '../logging/logger.js';
import { isRecord } from '../util/guards.js';
import { parseLenientTopLevelJson } from '../util/json.js';
import { createOpenAiCompatClient } from '../llm/openaiCompat.js';
import type { ChatMessage, LlmClient } from '../llm/types.js';
import {
  createFileConversationStore,
  createMemoryConversationStore,
  type ConversationStore,
  type ConversationTurn,
  type StoredConversation,
} from '../storage/conversationStore.js';
import { createToolRegistry, type ToolRegistry, type ToolResult } from './tools/index.js';
import { defaultAgentPolicy, type AgentPolicy } from './policy.js';
import { buildAgentPrompt } from './prompts/agentPrompt.js';
import { AGENT_JSON_TOOL_CALLS_SINGLE_OBJECT } from './prompts/intentMetadata.js';
import { classifyAgentIntent } from './prompts/intent.js';

function buildAgentPolicy(config: KaytooConfig, override?: AgentPolicy): AgentPolicy {
  const b = { ...defaultAgentPolicy, ...override };
  return {
    ...b,
    maxAggDepth: config.agent.maxAggDepth,
    maxAggsNodes: config.agent.maxAggsNodes,
    aggregateRequestTimeoutMs: config.agent.aggregateRequestTimeoutMs,
  };
}

export type AgentInput = {
  platform: ChatPlatform;
  address: ChatAddress;
  user: ChatUser;
  text: string;
  ts: string;
};

export type AgentResponse = { text: string };

export type AgentRuntime = {
  respond(input: AgentInput): Promise<AgentResponse>;
  /** Clear persisted thread memory for this channel/thread. */
  resetConversation(input: { platform: ChatPlatform; address: ChatAddress }): Promise<void>;
  /** Return a short text preview of stored thread context (for debugging / operators). */
  getConversationDebug(input: { platform: ChatPlatform; address: ChatAddress }): Promise<string>;
};

export async function createAgentRuntime(opts: {
  config: KaytooConfig;
  policy?: AgentPolicy;
}): Promise<AgentRuntime> {
  const policy = buildAgentPolicy(opts.config, opts.policy);
  const log = getLogger({ component: 'agent.runtime' });
  const llm = createOpenAiCompatClient({
    ...opts.config.llm,
    includeDebugBodies: opts.config.logging.includeDebugBodies,
  });
  const tools = await createToolRegistry({ config: opts.config, policy });
  const convCfg = opts.config.conversation;

  const store: ConversationStore = convCfg.storePath
    ? createFileConversationStore({ filePath: convCfg.storePath, ttlMs: convCfg.ttlSeconds * 1000 })
    : createMemoryConversationStore({ ttlMs: convCfg.ttlSeconds * 1000 });

  return {
    async resetConversation(input: { platform: ChatPlatform; address: ChatAddress }) {
      const key = threadMemoryKey(input.platform, input.address);
      await store.save(key, { turns: [], updatedAtMs: Date.now() });
    },

    async getConversationDebug(input: { platform: ChatPlatform; address: ChatAddress }) {
      const key = threadMemoryKey(input.platform, input.address);
      const s = await store.load(key);
      if (!s || s.turns.length === 0) return '(no stored conversation for this thread)';
      const tail = s.turns
        .slice(-6)
        .map((t) => `${t.role}: ${t.content.slice(0, 200)}${t.content.length > 200 ? '...' : ''}`)
        .join('\n');
      const sum = s.summary ? `Summary:\n${s.summary.slice(0, 1500)}${s.summary.length > 1500 ? '...' : ''}\n\n` : '';
      return `${sum}Recent turns:\n${tail}`;
    },

    async respond(input: AgentInput): Promise<AgentResponse> {
      const key = threadMemoryKey(input.platform, input.address);
      const prior = (await store.load(key)) ?? { turns: [], updatedAtMs: Date.now() };
      const { turns, summary } = await maybeFoldConversation({
        llm,
        summary: prior.summary,
        turns: [...prior.turns, { role: 'user' as const, content: input.text }],
        summarizeAfter: convCfg.summarizeAfterTurns,
        maxTurns: convCfg.maxTurns,
        log,
      });

      const reply = await runAgentLoop({
        llm,
        tools,
        turns,
        log,
        ...(summary ? { summary } : {}),
      }).catch((e) => {
        log.warn({ ...logErr(e) }, 'agent degraded (LLM/tools)');
        return `I'm having trouble reaching my analysis backend right now, but I'm still running. Try \`status\` or re-ask with more specifics.`;
      });

      const nextTurns = [...turns, { role: 'assistant' as const, content: reply }].slice(-convCfg.maxTurns);
      const toSave: StoredConversation = { turns: nextTurns, updatedAtMs: Date.now() };
      if (summary !== undefined && summary.length > 0) toSave.summary = summary;
      await store.save(key, toSave);

      return { text: reply };
    },
  };
}

/** Thread-scoped memory key (not per-user). */
function threadMemoryKey(platform: ChatPlatform, address: ChatAddress): string {
  return [platform, address.workspaceId ?? '', address.channelId, address.threadId ?? ''].join('|');
}

async function maybeFoldConversation(opts: {
  llm: LlmClient;
  summary: string | undefined;
  turns: ConversationTurn[];
  summarizeAfter: number;
  maxTurns: number;
  log: ReturnType<typeof getLogger>;
}): Promise<{ turns: ConversationTurn[]; summary: string | undefined }> {
  const { summary: initialSummary, turns: initialTurns } = opts;
  if (initialTurns.length <= opts.summarizeAfter) {
    return { turns: initialTurns.slice(-opts.maxTurns), summary: initialSummary };
  }

  const keep = Math.max(4, Math.floor(opts.summarizeAfter / 2));
  const toFold = initialTurns.slice(0, Math.max(0, initialTurns.length - keep));
  const kept = initialTurns.slice(-keep);
  if (toFold.length === 0) return { turns: initialTurns.slice(-opts.maxTurns), summary: initialSummary };

  try {
    const folded = await withDurationMs(opts.log, 'conversation_summarize', async () => {
      const prior = initialSummary ? `Prior summary:\n${initialSummary}\n\n` : '';
      const { content } = await opts.llm.chatCompletions({
        messages: [
          {
            role: 'system',
            content: 'Summarize this dialogue for assistant memory. Plain text only, 2-4 short bullets, no JSON.',
          },
          {
            role: 'user',
            content: `${prior}Dialogue to fold:\n${JSON.stringify(toFold)}`,
          },
        ],
        temperature: 0.2,
      });
      return content.trim();
    });
    const merged =
      initialSummary && folded
        ? `${initialSummary}\n---\n${folded}`
        : folded || initialSummary;
    return { turns: kept, summary: merged?.slice(0, 8000) };
  } catch (e) {
    opts.log.warn({ ...logErr(e) }, 'conversation summarization failed; truncating');
    return { turns: initialTurns.slice(-opts.maxTurns), summary: initialSummary };
  }
}

async function runAgentLoop(opts: {
  llm: LlmClient;
  tools: ToolRegistry;
  turns: ConversationTurn[];
  log: ReturnType<typeof getLogger>;
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
    const parsed = safeJsonParse({ raw: content, log: opts.log, context: 'agent.response_parse' });
    if (!isRecord(parsed)) {
      if (looksLikeToolCalls(content) && !repairAttempted) {
        const repaired = await repairInvalidToolCalls({ llm: opts.llm, messages, badText: content });
        const repairedParsed = safeJsonParse({ raw: repaired, log: opts.log, context: 'agent.response_repair_parse' });
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
        const repairedParsed = safeJsonParse({ raw: repaired, log: opts.log, context: 'agent.reply_repair_parse' });
        if (isRecord(repairedParsed)) {
          const toolCalls2 = normalizeToolCalls(repairedParsed['tool_calls'], opts.log, 'agent.tool_calls_reply_repair_parse');
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

function normalizeToolCalls(v: unknown, log: ReturnType<typeof getLogger>, context: string): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  const parsed = safeJsonParse({ raw: v, log, context });
  if (Array.isArray(parsed)) return parsed as unknown[];
  if (isRecord(parsed) && Array.isArray(parsed['tool_calls'])) return parsed['tool_calls'] as unknown[];
  return null;
}

function extractToolCallsFromText(raw: string, log: ReturnType<typeof getLogger>, context: string): unknown[] | null {
  const parsed = safeJsonParse({ raw, log, context });
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

const jsonParseWarnAt: { nextAtMs: number } = { nextAtMs: 0 };
function warnJsonParseDegraded(opts: { log: ReturnType<typeof getLogger>; context: string; raw: string; err: unknown }): void {
  const now = Date.now();
  if (now < jsonParseWarnAt.nextAtMs) return;
  jsonParseWarnAt.nextAtMs = now + 10 * 60_000;
  const snippet = opts.raw.length > 800 ? `${opts.raw.slice(0, 800)}...` : opts.raw;
  opts.log.warn(
    {
      degradedContext: opts.context,
      degradedSnippet: snippet,
      ...logErr(opts.err),
    },
    'agent JSON parse degraded (falling back)',
  );
}

function safeJsonParse(opts: { raw: string; log: ReturnType<typeof getLogger>; context: string }): unknown {
  const v = parseLenientTopLevelJson(opts.raw);
  if (v !== null) return v;
  warnJsonParseDegraded({ log: opts.log, context: opts.context, raw: opts.raw, err: new Error('unparseable JSON') });
  return null;
}

async function runToolCalls(opts: {
  tools: ToolRegistry;
  toolCalls: unknown[];
  log: ReturnType<typeof getLogger>;
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
