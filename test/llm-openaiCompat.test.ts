import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatClient } from '../src/llm/openaiCompat.js';
import { useSilentLogging } from './helpers/index.js';

const okSummaryJson = (text: string, post = true) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ post, text }) } }] }),
});

describe('llm', () => {
  useSilentLogging(beforeEach, afterEach);

  it('uses /v1/chat/completions when baseUrl ends in /v1 (no probe)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okSummaryJson('hello'));
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1/',
      apiKey: 'k',
      model: 'm',
    });

    await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://llm.example.com/v1/chat/completions');
  });

  it('uses /api/v1/chat/completions when baseUrl ends in /api/v1 (no probe)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okSummaryJson('hello'));
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/api/v1',
      apiKey: 'k',
      model: 'm',
    });

    await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://llm.example.com/api/v1/chat/completions');
  });

  it('probes /api/v1/models first on a bare baseUrl and pins /api/v1', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === 'GET' && url.endsWith('/api/v1/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }
      return Promise.resolve(okSummaryJson('via-api-v1'));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://ai.example.com',
      apiKey: 'k',
      model: 'm',
    });

    const r = await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });
    expect(r).toEqual({ post: true, text: 'via-api-v1' });

    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://ai.example.com/api/v1/models');
    expect(String(fetchSpy.mock.calls[1]![0])).toBe('https://ai.example.com/api/v1/chat/completions');
  });

  it('falls back to /v1 when the /api/v1 probe fails', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === 'GET' && url.endsWith('/api/v1/models')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (init.method === 'GET' && url.endsWith('/v1/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }
      return Promise.resolve(okSummaryJson('via-v1'));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://ai.example.com',
      apiKey: 'k',
      model: 'm',
    });

    const r = await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });
    expect(r).toEqual({ post: true, text: 'via-v1' });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe('https://ai.example.com/v1/chat/completions');
  });

  it('defaults to /v1 and warns when both probes fail', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === 'GET' && url.endsWith('/models')) {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return Promise.resolve(okSummaryJson('hello'));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://ai.example.com',
      apiKey: 'k',
      model: 'm',
    });

    await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe('https://ai.example.com/v1/chat/completions');
  });

  it('passes max_tokens when maxTokens is set', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    await llm.chatCompletions({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 16,
    });

    const [, init] = fetchSpy.mock.calls[0]!;
    const parsed = JSON.parse((init as { body: string }).body);
    expect(parsed.max_tokens).toBe(16);
  });

  it('retries the pinned URL on 429 before succeeding', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'slow down',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ post: true, text: 'after-429' }) } }] }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    const p = llm.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] });
    await vi.advanceTimersByTimeAsync(5000);
    const out = await p;
    expect(out.content).toBe(JSON.stringify({ post: true, text: 'after-429' }));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(String(fetchSpy.mock.calls[1]![0]));

    vi.useRealTimers();
  });

  it('throws with status code for non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'nope',
      }),
    );

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/401/i);
  });

  it('surfaces model and url in the failure message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => `{"detail":"'NoneType' object has no attribute 'startswith'"}`,
      }),
    );

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://ai.example.com/api/v1',
      apiKey: 'k',
      model: 'wrong-model',
    });

    await expect(llm.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      /model=wrong-model.*url=https:\/\/ai\.example\.com\/api\/v1\/chat\/completions/s,
    );
  });

  it('throws when content is empty or non-JSON', async () => {
    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/empty/i);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/non-JSON/i);
  });

  it('includes response text when available and tolerates text() failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Oops',
        text: async () => {
          throw new Error('boom');
        },
      }),
    );

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/500/i);
  });

  it('throws for invalid JSON payload shapes', async () => {
    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify([]) } }] }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/missing object/i);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: '   ' }) } }] }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/missing boolean.*post/i);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ post: true, text: '   ' }) } }] }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/non-empty.*text/i);
  });

  it('accepts post false with empty text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ post: false, text: '' }) } }] }),
      }),
    );

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
    });

    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).resolves.toEqual({
      post: false,
      text: '',
    });
  });
});
