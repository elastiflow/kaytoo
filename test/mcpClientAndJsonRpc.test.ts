import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeOpenSearchMcpServer } from '../src/opensearch/mcpClient.js';
import { mcpJsonRpcCall } from '../src/agent/mcpJsonRpc.js';

afterEach(() => vi.unstubAllGlobals());

describe('probeOpenSearchMcpServer', () => {
  it('ok / non-OK / errors / headers', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', ok);
    await expect(probeOpenSearchMcpServer({ url: 'https://mcp/x' })).resolves.toEqual({ ok: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'X' }));
    await expect(probeOpenSearchMcpServer({ url: 'https://mcp/x' })).resolves.toEqual({
      ok: false,
      warning: 'MCP probe failed: 503 X',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(probeOpenSearchMcpServer({ url: 'https://mcp/x' })).resolves.toEqual({
      ok: false,
      warning: 'MCP probe error: down',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('weird'));
    await expect(probeOpenSearchMcpServer({ url: 'https://mcp/x' })).resolves.toEqual({
      ok: false,
      warning: 'MCP probe error: weird',
    });

    const h = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', h);
    await probeOpenSearchMcpServer({ url: 'https://mcp/x', headers: { 'x-api-key': 'k' } });
    expect(h).toHaveBeenCalledWith(
      'https://mcp/x',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'k' }) }),
    );
  });
});

describe('mcpJsonRpcCall', () => {
  it('success path and request shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { a: 1 } }),
      }),
    );
    expect(await mcpJsonRpcCall({ url: 'https://rpc', method: 'tools/list' })).toEqual({
      ok: true,
      result: { a: 1 },
    });
    const f = vi.mocked(fetch);
    const body = JSON.parse((f.mock.calls[0]![1] as { body: string }).body);
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
    expect(body.params).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }),
      }),
    );
    await mcpJsonRpcCall({ url: 'https://rpc', bearer: 'secret', method: 'call', params: { x: 1 } });
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as { body: string }).body).params).toEqual({ x: 1 });
  });

  it('failure modes', async () => {
    const cases: [ReturnType<typeof vi.fn>, unknown][] = [
      [
        vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'x'.repeat(200) }),
        { ok: false, error: expect.stringMatching(/^HTTP 500:/) },
      ],
      [
        vi.fn().mockResolvedValue({ ok: true, text: async () => 'not json {' }),
        { ok: false, error: expect.stringMatching(/^Non-JSON RPC/) },
      ],
      [vi.fn().mockResolvedValue({ ok: true, text: async () => '42' }), { ok: false, error: expect.stringMatching(/^Invalid JSON-RPC/) }],
      [
        vi.fn().mockResolvedValue({
          ok: true,
          text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }),
        }),
        { ok: false, error: '{"code":-1}' },
      ],
      [vi.fn().mockRejectedValue(new Error('boom')), { ok: false, error: 'boom' }],
      [vi.fn().mockRejectedValue('x'), { ok: false, error: 'x' }],
    ];
    for (const [mockFetch, want] of cases) {
      vi.stubGlobal('fetch', mockFetch);
      expect(await mcpJsonRpcCall({ url: 'https://rpc', method: 'm' })).toEqual(want);
    }
  });
});
