export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmClient = {
  chatCompletions(input: {
    messages: ChatMessage[];
    temperature?: number;
    /** Maps to OpenAI-compatible `max_tokens` when set. */
    maxTokens?: number;
  }): Promise<{ content: string }>;
  summarizeFindings(input: { channelStyle: 'slack'; findings: unknown[] }): Promise<{ text: string }>;
};

