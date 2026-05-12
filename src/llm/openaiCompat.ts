import type { Logger as PinoLogger } from 'pino';
import type { KaytooConfig } from '../config.js';
import type { Finding } from '../detectors/types.js';
import { getLogger, withDurationMs } from '../logging/logger.js';
import { isRecord } from '../util/guards.js';
import { parseLenientTopLevelJson } from '../util/json.js';
import { sleepMs } from '../util/sleep.js';
import { buildSlackSummaryPrompt } from './prompt.js';
import type { ChatMessage, LlmClient } from './types.js';

type OpenAiChatResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

export type OpenAiCompatConfig = KaytooConfig['llm'] & { includeDebugBodies?: boolean };

// Resolve the chat-completions URL once and pin it. If baseUrl already includes
// /v1 or /api/v1 we honor it. Otherwise we probe /api/v1/models then /v1/models
// (OpenWebUI is more common in self-hosted setups; OpenAI exposes /v1) and pin
// whichever responds 2xx. If both fail we default to /v1 and warn so the next
// real request surfaces a useful error including the URL.
async function resolveChatUrl(baseUrl: string, apiKey: string, log: PinoLogger): Promise<string> {
  const lower = baseUrl.toLowerCase();
  if (lower.endsWith('/v1') || lower.endsWith('/api/v1')) return `${baseUrl}/chat/completions`;

  const candidates = [
    { prefix: '/api/v1', models: `${baseUrl}/api/v1/models`, chat: `${baseUrl}/api/v1/chat/completions` },
    { prefix: '/v1', models: `${baseUrl}/v1/models`, chat: `${baseUrl}/v1/chat/completions` },
  ];
  const headers = { authorization: `Bearer ${apiKey}` };

  for (const c of candidates) {
    const ok = await fetch(c.models, { method: 'GET', headers })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      log.info({ chatUrl: c.chat, probed: c.models }, 'resolved LLM endpoint');
      return c.chat;
    }
  }

  log.warn({ baseUrl }, 'could not probe LLM /models at /api/v1 or /v1; defaulting to /v1/chat/completions');
  return `${baseUrl}/v1/chat/completions`;
}

const resolveChatUrlByBaseAndKey = new Map<string, Promise<string>>();

function sharedResolveChatUrl(baseUrl: string, apiKey: string, log: PinoLogger): Promise<string> {
  const key = `${baseUrl}\0${apiKey}`;
  const hit = resolveChatUrlByBaseAndKey.get(key);
  if (hit) return hit;
  const p = resolveChatUrl(baseUrl, apiKey, log);
  resolveChatUrlByBaseAndKey.set(key, p);
  return p;
}

/** Test helper: clears cached /models probe so fetch mocks stay isolated. */
export function resetOpenAiCompatResolveCache(): void {
  resolveChatUrlByBaseAndKey.clear();
}

function llmErrorBodyHint(body: string): string {
  if (/NoneType.*startswith|startswith.*NoneType/i.test(body)) {
    return ' LiteLLM/OpenWebUI often emits this when the model id is not registered on the gateway; match LLM_MODEL to the admin model list exactly.';
  }
  return '';
}

export function createOpenAiCompatClient(config: OpenAiCompatConfig): LlmClient {
  const log = getLogger({ component: 'llm' });
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const includeBodies = config.includeDebugBodies ?? false;
  const chatUrlPromise = sharedResolveChatUrl(baseUrl, config.apiKey, log);

  return {
    async chatCompletions(input: { messages: ChatMessage[]; temperature?: number; maxTokens?: number }) {
      const chatUrl = await chatUrlPromise;
      return withDurationMs(log, 'chat_completions', async () => {
        if (includeBodies) log.debug({ model: config.model, messages: input.messages }, 'llm request');

        const body = JSON.stringify({
          model: config.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.2,
          stream: false,
          ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
        });

        const headers = {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        } as const;

        const max429Retries = 6;

        const postWith429Retries = async (r429: number): Promise<{ content: string }> => {
          const resp = await fetch(chatUrl, { method: 'POST', headers, body });
          if (resp.ok) {
            const data = (await resp.json()) as OpenAiChatResponse;
            if (includeBodies) log.debug({ responsePreview: JSON.stringify(data).slice(0, 4000) }, 'llm response');
            const content = data.choices?.[0]?.message?.content ?? '';
            if (!content) throw new Error('LLM returned empty content');
            return { content };
          }

          const text = await resp.text().catch(() => '');
          if (resp.status === 429 && r429 < max429Retries) {
            const waitMs = Math.min(30_000, 2000 * 2 ** r429);
            log.warn({ url: chatUrl, attempt: r429 + 1, waitMs }, 'llm rate limited (429); retrying');
            await sleepMs(waitMs);
            return postWith429Retries(r429 + 1);
          }
          const hint = llmErrorBodyHint(text);
          throw new Error(
            `LLM request failed: ${resp.status} ${resp.statusText} (model=${config.model}, url=${chatUrl})${text ? `\n${text}` : ''}${hint ? `\n${hint}` : ''}`,
          );
        };

        return postWith429Retries(0);
      });
    },

    async summarizeFindings(input: { channelStyle: 'slack'; findings: unknown[] }): Promise<{ post: boolean; text: string }> {
      const findings = input.findings as Finding[];
      const messages = buildSlackSummaryPrompt(findings);

      const { content } = await this.chatCompletions({ messages, temperature: 0.2 });

      const parsed = parseLenientTopLevelJson(content);
      if (parsed === null) {
        const snippet = content.length > 800 ? `${content.slice(0, 800)}...` : content;
        getLogger({ component: 'llm' }).warn(
          { degradedContext: 'llm.slack_summary_parse', degradedSnippet: snippet },
          'LLM JSON parse degraded',
        );
        throw new Error(`LLM returned non-JSON content:\n${content}`);
      }
      if (!isRecord(parsed)) throw new Error('LLM JSON missing object');
      const postRaw = parsed['post'];
      if (typeof postRaw !== 'boolean') throw new Error('LLM JSON missing boolean "post"');
      if (postRaw === false) {
        const t = parsed['text'];
        return { post: false, text: typeof t === 'string' ? t : '' };
      }
      const text = parsed['text'];
      if (typeof text !== 'string' || !text.trim()) throw new Error('LLM JSON missing non-empty "text" when post is true');

      return { post: true, text: text.trim() };
    },
  };
}

