import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buffer } from 'node:stream/consumers';
import type { Logger } from 'pino';
import { createAgentRuntime } from './agent/runtime.js';
import { ChatRouter } from './chat/router.js';
import type { ChatEvent } from './chat/types.js';
import type { KaytooConfig } from './config.js';
import type { Notifier } from './notify/notifier.js';
import { thrownMessage } from './util/guards.js';
import { parseJsonOrThrow } from './util/json.js';

function parseBind(bind: string): { host: string; port: number } {
  const m = bind.trim().match(/^(.*):(\d+)$/);
  if (!m) throw new Error(`Invalid KAYTOO_HTTP_CHAT_BIND (expected host:port): ${JSON.stringify(bind)}`);
  return { host: m[1] || '0.0.0.0', port: Number.parseInt(m[2]!, 10) };
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const bin = await buffer(req);
  const raw = bin.toString('utf8').trim();
  if (!raw) return {};
  return parseJsonOrThrow({ raw, context: 'e2eHttpChatServer.readJsonBody' });
}

/**
 * Minimal HTTP surface for e2e / automation when KAYTOO_OUTPUT=console (no Slack).
 * POST /chat with JSON body `{ "text": "..." }` returns `{ "replies": string[] }`.
 */
export async function startE2eHttpChatServer(opts: {
  config: KaytooConfig;
  bind: string;
  log: Logger;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  const { host, port } = parseBind(opts.bind);
  const repliesState: { lines: readonly string[] } = { lines: [] };
  const notifier: Notifier = {
    async post(input) {
      repliesState.lines = [...repliesState.lines, input.text];
    },
  };

  // Lazy-init: /health binds immediately; agent/tools may still be wiring to OpenSearch.
  let routerPromise: Promise<ChatRouter> | null = null;
  const getRouter = () => {
    routerPromise ??= (async () => {
      const agent = await createAgentRuntime({ config: opts.config });
      return new ChatRouter({
        notifier,
        agent,
        status: async () => 'kaytoo: ok (e2e http)',
      });
    })();
    return routerPromise;
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'POST' && req.url === '/chat') {
        const router = await getRouter();
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: thrownMessage(e) }));
          return;
        }
        const text =
          body && typeof body === 'object' && typeof (body as Record<string, unknown>)['text'] === 'string'
            ? ((body as Record<string, unknown>)['text'] as string).trim()
            : '';
        if (!text) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'expected JSON body { "text": "..." }' }));
          return;
        }
        repliesState.lines = [];
        const evt: ChatEvent = {
          type: 'message',
          platform: 'e2e',
          address: { platform: 'e2e', channelId: 'e2e-http' },
          user: { id: 'e2e' },
          text,
          ts: new Date().toISOString(),
        };
        await router.handleEvent(evt);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ replies: [...repliesState.lines] }));
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      opts.log.error({ err: e }, 'e2e http chat error');
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: thrownMessage(e) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const bound = server.address();
  const listenPort =
    typeof bound === 'object' && bound !== null ? (bound as AddressInfo).port : port;
  opts.log.info({ host, port: listenPort }, 'e2e http chat listening');

  return {
    port: listenPort,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
