import type { ChatEvent } from '../types.js';
import { getLogger, logErr } from '../../logging/logger.js';
import { sleepMs } from '../../util/sleep.js';
import { parseJsonOrNull } from '../../util/json.js';

const log = getLogger({ component: 'chat.mattermost' });

export type MattermostWsCtor = typeof WebSocket;

type PostedPayload = {
  post?: {
    id?: string;
    root_id?: string;
    user_id?: string;
    channel_id?: string;
    message?: string;
    create_at?: number;
  };
};

function toWebsocketUrl(baseUrl: string): string {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const ws = new URL('api/v4/websocket', base);
  ws.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return ws.toString();
}

function parsePostedData(raw: unknown): PostedPayload | null {
  if (typeof raw === 'string') {
    const parsed = parseJsonOrNull({ raw, context: 'mattermost.parsePostedData', log });
    if (parsed === null || !parsed || typeof parsed !== 'object') return null;
    return parsed as PostedPayload;
  }
  if (raw && typeof raw === 'object') return raw as PostedPayload;
  return null;
}

export function startMattermostAdapter(opts: {
  baseUrl: string;
  token: string;
  channelId: string;
  botUserId?: string;
  onEvent: (evt: ChatEvent) => Promise<void>;
  /** Optional `WebSocket` constructor (e.g. non-browser runtimes). */
  wsFactory?: MattermostWsCtor;
}): { stop: () => void } {
  const controller = new AbortController();
  const Ws = opts.wsFactory ?? globalThis.WebSocket;
  const state = {
    socket: null as WebSocket | null,
    seq: 1,
    reconnectMs: 1000,
  };

  const emitPost = async (p: NonNullable<PostedPayload['post']>): Promise<void> => {
    if (opts.botUserId && p.user_id === opts.botUserId) return;
    if (p.channel_id !== opts.channelId) return;
    if (typeof p.message !== 'string' || !p.message.trim()) return;
    if (!p.create_at) return;
    const rootId = typeof p.root_id === 'string' && p.root_id.trim() ? p.root_id : undefined;
    const postId = typeof p.id === 'string' ? p.id : undefined;
    const threadAnchor = rootId ?? postId;
    const evt: ChatEvent = {
      type: 'message',
      platform: 'mattermost',
      address: {
        platform: 'mattermost',
        channelId: opts.channelId,
        ...(threadAnchor ? { threadId: threadAnchor } : {}),
      },
      user: { id: p.user_id ?? 'unknown' },
      text: p.message,
      ts: new Date(p.create_at).toISOString(),
    };
    await opts.onEvent(evt);
  };

  const onEnvelope = async (parsed: Record<string, unknown>): Promise<void> => {
    if (parsed['event'] !== 'posted') return;
    const payload = parsePostedData(parsed['data']);
    const post = payload?.post;
    if (!post) return;
    await emitPost(post);
  };

  const connectOnce = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const url = toWebsocketUrl(opts.baseUrl);
      const flags = { settled: false, handshakeDone: false };
      const ws = new Ws(url);
      state.socket = ws;

      const fail = (e: unknown): void => {
        if (flags.settled) return;
        flags.settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      };

      const succeed = (): void => {
        if (flags.settled) return;
        flags.settled = true;
        resolve();
      };

      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({
            action: 'authentication_challenge',
            seq: state.seq++,
            data: { token: opts.token },
          }),
        );
      });

      ws.addEventListener('message', (e) => {
        const parsed = parseJsonOrNull({ raw: String(e.data), context: 'mattermost.ws.envelope', log });
        if (parsed === null || !parsed || typeof parsed !== 'object') return;

        if (!flags.handshakeDone) {
          const o = parsed as Record<string, unknown>;
          if (o['status'] === 'OK') {
            flags.handshakeDone = true;
            state.reconnectMs = 1000;
            succeed();
            return;
          }
          const err = o['error'];
          if (err != null) {
            fail(new Error(`mattermost websocket auth failed: ${String(err)}`));
            return;
          }
          return;
        }

        void onEnvelope(parsed as Record<string, unknown>).catch((err) => log.warn({ ...logErr(err) }, 'mattermost ws handler error'));
      });

      ws.addEventListener('error', () => {
        fail(new Error('mattermost websocket error'));
      });
    });

  const run = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        await connectOnce();
        const ws = state.socket;
        if (!ws) continue;
        await new Promise<void>((resolve) => {
          const onClose = (): void => {
            ws.removeEventListener('close', onClose);
            resolve();
          };
          ws.addEventListener('close', onClose);
          const onAbort = (): void => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
      } catch (e) {
        log.warn({ ...logErr(e), reconnectMs: state.reconnectMs }, 'mattermost websocket session ended');
      }
      if (controller.signal.aborted) break;
      state.socket = null;
      await sleepMs(state.reconnectMs);
      state.reconnectMs = Math.min(state.reconnectMs * 2, 30_000);
    }
  };

  void run();

  log.info({ channelId: opts.channelId }, 'mattermost adapter started');

  return {
    stop: () => {
      controller.abort();
      try {
        state.socket?.close();
      } catch {
        /* ignore */
      }
      state.socket = null;
    },
  };
}
