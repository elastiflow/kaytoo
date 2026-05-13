import type { ChatAddress, ChatPlatform, ChatUser } from '../chat/types.js';
import type { KaytooConfig } from '../config.js';
import { getLogger, logErr, withDurationMs } from '../logging/logger.js';
import { createOpenAiCompatClient } from '../llm/openaiCompat.js';
import type { LlmClient } from '../llm/types.js';
import {
  createFileConversationStore,
  createMemoryConversationStore,
  type ConversationStore,
  type ConversationTurn,
  type StoredConversation,
} from '../storage/conversationStore.js';
import { createToolRegistry } from './tools/index.js';
import { defaultAgentPolicy, type AgentPolicy } from './policy.js';
import { runAgentLoop } from './agentLoop.js';

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
