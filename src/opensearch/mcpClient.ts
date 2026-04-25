import { thrownMessage } from '../util/guards.js';

export type McpProbeResult = { ok: boolean; warning?: string };

export async function probeOpenSearchMcpServer(opts: {
  url: string;
  headers?: Record<string, string>;
}): Promise<McpProbeResult> {
  try {
    const resp = await fetch(opts.url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        ...(opts.headers ?? {}),
      },
    });
    if (!resp.ok) return { ok: false, warning: `MCP probe failed: ${resp.status} ${resp.statusText}` };
    // We don't keep the stream open here; this is just a reachability check.
    return { ok: true };
  } catch (e) {
    return { ok: false, warning: `MCP probe error: ${thrownMessage(e)}` };
  }
}

