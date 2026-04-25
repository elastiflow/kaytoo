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

export function createOpenAiCompatClient(config: OpenAiCompatConfig): LlmClient {
  const log = getLogger({ component: 'llm' });
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const includeBodies = config.includeDebugBodies ?? false;

  function candidateChatUrls(): string[] {
    // Common OpenAI-compatible routes vary by server:
    // - https://host/v1/chat/completions (OpenAI, many proxies)
    // - https://host/api/v1/chat/completions (common for OpenWebUI)
    // Also accept base URLs that already include /v1 or /api/v1.
    const lower = baseUrl.toLowerCase();
    if (lower.endsWith('/v1')) return [`${baseUrl}/chat/completions`];
    if (lower.endsWith('/api/v1')) return [`${baseUrl}/chat/completions`];
    return [`${baseUrl}/v1/chat/completions`, `${baseUrl}/api/v1/chat/completions`];
  }

  return {
    async chatCompletions(input: { messages: ChatMessage[]; temperature?: number; maxTokens?: number }) {
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

        const urls = candidateChatUrls();
        const max429Retries = 6;

        type UrlAttempt = { kind: 'ok'; content: string } | { kind: 'nextUrl'; err: Error } | { kind: 'fatal'; err: Error };

        const postWith429Retries = async (url: string, r429: number): Promise<UrlAttempt> => {
          const fetched = await fetch(url, { method: 'POST', headers, body }).then(
            (r) => ({ ok: true as const, r }),
            (e: unknown) => ({
              ok: false as const,
              err: e instanceof Error ? e : new Error(String(e)),
            }),
          );
          if (!fetched.ok) return { kind: 'nextUrl', err: fetched.err };

          const resp = fetched.r;
          if (resp.ok) {
            const data = (await resp.json()) as OpenAiChatResponse;
            if (includeBodies) log.debug({ responsePreview: JSON.stringify(data).slice(0, 4000) }, 'llm response');

            const content = data.choices?.[0]?.message?.content ?? '';
            if (!content) return { kind: 'fatal', err: new Error('LLM returned empty content') };
            return { kind: 'ok', content };
          }

          const text = await resp.text().catch(() => '');
          const err = new Error(`LLM request failed: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`);
          if (resp.status === 429 && r429 < max429Retries) {
            const waitMs = Math.min(30_000, 2000 * 2 ** r429);
            log.warn({ url, attempt: r429 + 1, waitMs }, 'llm rate limited (429); retrying');
            await sleepMs(waitMs);
            return postWith429Retries(url, r429 + 1);
          }
          if (resp.status === 404 || resp.status === 405) return { kind: 'nextUrl', err };
          return { kind: 'fatal', err };
        };

        const tryAt = async (i: number, lastErr: Error | null): Promise<{ content: string }> => {
          if (i >= urls.length) {
            throw lastErr ?? new Error('LLM request failed: no reachable OpenAI-compatible endpoint');
          }
          const url = urls[i]!;
          const attempt = await postWith429Retries(url, 0);
          if (attempt.kind === 'ok') return { content: attempt.content };
          if (attempt.kind === 'fatal') throw attempt.err;
          return tryAt(i + 1, attempt.err);
        };

        return tryAt(0, null);

      });
    },

    async summarizeFindings(input: { channelStyle: 'slack'; findings: unknown[] }): Promise<{ text: string }> {
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
      if (!isRecord(parsed)) throw new Error('LLM JSON missing "text"');
      const text = parsed['text'];
      if (typeof text !== 'string' || !text.trim()) throw new Error('LLM JSON missing "text"');

      return { text };
    },
  };
}

