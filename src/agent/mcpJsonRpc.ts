/** MCP-style JSON-RPC POST; failures are soft (caller inspects `ok`). */
import { thrownMessage } from '../util/guards.js';
import { parseJsonOrNull } from '../util/json.js';
import { getLogger } from '../logging/logger.js';

export async function mcpJsonRpcCall(opts: {
  url: string;
  bearer?: string;
  method: string;
  params?: unknown;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const log = getLogger({ component: 'agent.mcpJsonRpc' });
  const id = Math.floor(Math.random() * 1_000_000_000);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: opts.method,
    ...(opts.params !== undefined ? { params: opts.params } : {}),
  });

  try {
    const resp = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
      },
      body,
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 500)}` };
    const parsed = parseJsonOrNull({ raw: text, context: 'mcpJsonRpcCall.response', log });
    if (parsed === null || !parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        error:
          parsed === null
            ? `Non-JSON RPC response: ${text.slice(0, 500)}`
            : `Invalid JSON-RPC response: ${text.slice(0, 500)}`,
      };
    }
    const o = parsed as Record<string, unknown>;
    if (o['error'] != null) return { ok: false, error: JSON.stringify(o['error']).slice(0, 2000) };
    return { ok: true, result: o['result'] };
  } catch (e) {
    return { ok: false, error: thrownMessage(e) };
  }
}
