/** Minimal `process.env` fragment for `getConfig` in agent / LLM tests. */
export const MINIMAL_AGENT_ENV = {
  OPENSEARCH_URL: 'https://os.test',
  OPENSEARCH_USERNAME: 'a',
  OPENSEARCH_PASSWORD: 'b',
  LLM_BASE_URL: 'https://llm.test',
  LLM_API_KEY: 'k',
} as const;

export type MinimalAgentEnvOverrides = Record<string, string | undefined>;

export function minimalAgentEnv(overrides?: MinimalAgentEnvOverrides): Record<string, string | undefined> {
  return { ...MINIMAL_AGENT_ENV, ...overrides };
}
