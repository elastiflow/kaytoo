import type { LlmClient } from '../../llm/types.js';
import { getLogger, logErr } from '../../logging/logger.js';
import {
  INTENT_CLASSIFIER_HINTS,
  KAYTOO_ROUTING_PRODUCT_LABEL,
  type AgentIntent,
} from './intentMetadata.js';

type Log = ReturnType<typeof getLogger>;

export type { AgentIntent };
export const intentIdToClassifierHint = INTENT_CLASSIFIER_HINTS;

const ROUTING_MAX_TOKENS = 16;
const ROUTING_MAX_USER_CHARS = 2000;
const DEFAULT_INTENT: AgentIntent = 'FLOW_ANALYTICS';

let nextParseFallbackLogMs = 0;

function routingSystemPrompt(): string {
  const ids = Object.keys(INTENT_CLASSIFIER_HINTS) as AgentIntent[];
  return [
    `Classify this message for ${KAYTOO_ROUTING_PRODUCT_LABEL}. Output one token only, no punctuation.`,
    `Allowed: ${ids.join(', ')}.`,
    ...ids.map((id) => `${id}: ${INTENT_CLASSIFIER_HINTS[id]}`),
  ].join(' ');
}

export function parseIntentLabel(raw: string): AgentIntent | null {
  const t = (raw.trim().split(/\r?\n/)[0] ?? '').match(/^[\s]*([A-Za-z0-9_]+)/)?.[1]?.toUpperCase() ?? '';
  return t in INTENT_CLASSIFIER_HINTS ? (t as AgentIntent) : null;
}

export async function classifyAgentIntent(opts: {
  llm: LlmClient;
  userText: string;
  log: Log;
}): Promise<AgentIntent> {
  const { llm, userText, log } = opts;
  const user =
    userText.length > ROUTING_MAX_USER_CHARS
      ? `${userText.slice(0, ROUTING_MAX_USER_CHARS)}\n\n[truncated]`
      : userText || '(empty message)';

  try {
    const { content } = await llm.chatCompletions({
      messages: [
        { role: 'system', content: routingSystemPrompt() },
        { role: 'user', content: user },
      ],
      temperature: 0,
      maxTokens: ROUTING_MAX_TOKENS,
    });
    const id = parseIntentLabel(content);
    if (id) return id;
    const now = Date.now();
    if (now >= nextParseFallbackLogMs) {
      nextParseFallbackLogMs = now + 10 * 60_000;
      log.warn({}, 'intent classify: invalid token; using FLOW_ANALYTICS');
    }
    return DEFAULT_INTENT;
  } catch (e) {
    log.warn({ ...logErr(e) }, 'intent classify: request failed; using FLOW_ANALYTICS');
    return DEFAULT_INTENT;
  }
}
