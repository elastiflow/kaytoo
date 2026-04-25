import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { getConfig } from '../src/config.js';

vi.mock('../src/agent/runtime.js', () => ({
  createAgentRuntime: vi.fn().mockResolvedValue({
    respond: vi.fn().mockResolvedValue({ text: 'agent-reply' }),
    resetConversation: vi.fn(),
    getConversationDebug: vi.fn().mockResolvedValue(''),
  }),
}));

import { createAgentRuntime } from '../src/agent/runtime.js';
import { startE2eHttpChatServer } from '../src/e2eHttpChatServer.js';

const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;

function consoleCfg() {
  return getConfig({
    OPENSEARCH_URL: 'https://os.test',
    OPENSEARCH_USERNAME: 'u',
    OPENSEARCH_PASSWORD: 'p',
    LLM_BASE_URL: 'https://llm.test',
    LLM_API_KEY: 'k',
  });
}

describe('startE2eHttpChatServer', () => {
  it('rejects invalid bind', async () => {
    await expect(startE2eHttpChatServer({ config: consoleCfg(), bind: 'bad', log })).rejects.toThrow(
      /Invalid KAYTOO_HTTP_CHAT_BIND/,
    );
  });

  it('GET /health does not init agent', async () => {
    const { stop, port } = await startE2eHttpChatServer({ config: consoleCfg(), bind: '127.0.0.1:0', log });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(createAgentRuntime)).not.toHaveBeenCalled();
    await stop();
  });

  it('bind may omit host (defaults to 0.0.0.0)', async () => {
    const { stop, port } = await startE2eHttpChatServer({ config: consoleCfg(), bind: ':0', log });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await stop();
  });

  it('POST /chat validates body and returns replies', async () => {
    const { stop, port } = await startE2eHttpChatServer({ config: consoleCfg(), bind: '127.0.0.1:0', log });
    const base = `http://127.0.0.1:${port}`;

    let res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(res.status).toBe(400);

    res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);

    res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 1 }),
    });
    expect(res.status).toBe(400);

    res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);

    res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: ' hi ' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replies: ['agent-reply'] });

    res = await fetch(`${base}/missing`);
    expect(res.status).toBe(404);

    await stop();
  });
});
