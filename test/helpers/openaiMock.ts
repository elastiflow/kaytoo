/** Shape returned by stubbed `fetch` for OpenAI-compatible chat completions. */
export function mockOpenAiChatCompletionResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  };
}
