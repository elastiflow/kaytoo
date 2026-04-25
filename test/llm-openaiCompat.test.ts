import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatClient } from '../src/llm/openaiCompat.js';
import { useSilentLogging } from './helpers/index.js';

describe('llm', () => {
  useSilentLogging(beforeEach, afterEach);

  it('createOpenAiCompatClient posts to /v1/chat/completions and returns parsed text', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ text: 'hello' }) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/',
      apiKey: 'k',
      model: 'm',
    });

    const resp = await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });
    expect(resp.text).toBe('hello');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://llm.example.com/v1/chat/completions');
    expect((init as { method: string }).method).toBe('POST');
  });

  it('createOpenAiCompatClient passes max_tokens when maxTokens is set', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/',
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

  it('createOpenAiCompatClient supports baseUrl ending in /v1 (no double /v1)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ text: 'hello' }) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/v1/',
      apiKey: 'k',
      model: 'm',
    });

    await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://llm.example.com/v1/chat/completions');
  });

  it('createOpenAiCompatClient supports baseUrl ending in /api/v1', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ text: 'hello' }) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com/api/v1',
      apiKey: 'k',
      model: 'm',
    });

    await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://llm.example.com/api/v1/chat/completions');
  });

  it('createOpenAiCompatClient falls back from /v1 to /api/v1 on 404/405', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 405,
        statusText: 'Method Not Allowed',
        text: async () => 'nope',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ text: 'hello' }) } }],
        }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com',
      apiKey: 'k',
      model: 'm',
    });

    const resp = await llm.summarizeFindings({ channelStyle: 'slack', findings: [] });
    expect(resp.text).toBe('hello');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://llm.example.com/v1/chat/completions');
    expect(String(fetchSpy.mock.calls[1]![0])).toBe('https://llm.example.com/api/v1/chat/completions');
  });

  it('createOpenAiCompatClient retries same URL on 429 before succeeding', async () => {
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
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ text: 'after-429' }) } }],
        }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com',
      apiKey: 'k',
      model: 'm',
    });

    const p = llm.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] });
    await vi.advanceTimersByTimeAsync(5000);
    const out = await p;
    expect(out.content).toBe(JSON.stringify({ text: 'after-429' }));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(String(fetchSpy.mock.calls[1]![0]));

    vi.useRealTimers();
  });

  it('createOpenAiCompatClient throws for non-ok responses', async () => {
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
      baseUrl: 'https://llm.example.com',
      apiKey: 'k',
      model: 'm',
    });

    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/401/i);
  });

  it('createOpenAiCompatClient throws when content is empty or non-JSON', async () => {
    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com',
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

  it('createOpenAiCompatClient includes response text when available and tolerates text() failures', async () => {
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
      baseUrl: 'https://llm.example.com',
      apiKey: 'k',
      model: 'm',
    });

    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/500/i);
  });

  it('createOpenAiCompatClient throws for invalid JSON payload shapes', async () => {
    const llm = createOpenAiCompatClient({
      baseUrl: 'https://llm.example.com',
      apiKey: 'k',
      model: 'm',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([]) } }],
        }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/missing "text"/i);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ text: '   ' }) } }],
        }),
      }),
    );
    await expect(llm.summarizeFindings({ channelStyle: 'slack', findings: [] })).rejects.toThrow(/missing "text"/i);
  });
});

