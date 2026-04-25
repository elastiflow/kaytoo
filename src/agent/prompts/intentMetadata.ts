export const DEFAULT_AGENT_MINUTES_BACK = 15;

export const KAYTOO_ROUTING_PRODUCT_LABEL = 'Kaytoo (ElastiFlow)';

export const KAYTOO_AGENT_SYSTEM_IDENTITY = 'You are Kaytoo (network observability).';

export const KAYTOO_SLACK_SUMMARY_IDENTITY = 'You are Kaytoo, a network observability assistant.';

export const AGENT_JSON_TOOL_CALLS_SINGLE_OBJECT = '{"tool_calls":[{"name":"...","args":{...}}]}';

export const INTENT_CLASSIFIER_HINTS = {
  FLOW_ANALYTICS: 'traffic, namespaces, pods, bytes, flows, baselines, rankings.',
  TROUBLESHOOTING: 'incident or control-plane diagnosis; flows are partial evidence only.',
  GENERAL_CHAT: 'help, how-to, greetings, or no flow analysis needed.',
} as const;

export type AgentIntent = keyof typeof INTENT_CLASSIFIER_HINTS;
