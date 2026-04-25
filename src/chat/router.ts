import type { Notifier } from '../notify/notifier.js';
import type { AgentRuntime } from '../agent/runtime.js';
import { runWithLogContextAsync } from '../logging/context.js';
import { getLogger, logErr } from '../logging/logger.js';
import type { ChatEvent, ChatPost } from './types.js';

const log = getLogger({ component: 'chat.router' });

export type ChatRouterDeps = {
  notifier: Notifier;
  agent: AgentRuntime;
  status: () => Promise<string>;
};

export class ChatRouter {
  constructor(private readonly deps: ChatRouterDeps) {}

  async handleEvent(evt: ChatEvent): Promise<void> {
    if (evt.type !== 'message') return;

    const trimmed = evt.text.trim();
    if (!trimmed) return;

    return runWithLogContextAsync(
      {
        platform: evt.platform,
        channelId: evt.address.channelId,
        threadId: evt.address.threadId,
        workspaceId: evt.address.workspaceId,
        userId: evt.user.id,
        eventId: evt.eventId ?? evt.ts,
      },
      async () => {
        try {
          const cmd = parseCommand(trimmed);
          if (cmd) {
            const reply = await this.handleCommand(cmd, evt);
            await this.deps.notifier.post(this.replyTo(evt, reply));
            return;
          }

          const resp = await this.deps.agent.respond({
            platform: evt.platform,
            address: evt.address,
            user: evt.user,
            text: trimmed,
            ts: evt.ts,
          });

          await this.deps.notifier.post(this.replyTo(evt, resp.text));
        } catch (e) {
          log.error(e instanceof Error ? { err: e } : { ...logErr(e) }, 'handleEvent failed');
        }
      },
    );
  }

  private replyTo(evt: ChatEvent, text: string): ChatPost {
    return {
      address: evt.address,
      text,
    };
  }

  private async handleCommand(cmd: ParsedCommand, evt: ChatEvent): Promise<string> {
    switch (cmd.name) {
      case 'help':
        return [
          'Kaytoo commands:',
          '- help',
          '- status',
          '- reset (clear conversation memory for this thread)',
          '- summarize (show stored thread context preview)',
          '',
          'Ask me questions about network activity, or paste an IP and what you want to investigate.',
        ].join('\n');
      case 'status':
        return await this.deps.status();
      case 'reset':
        await this.deps.agent.resetConversation({ platform: evt.platform, address: evt.address });
        return 'Conversation memory cleared for this thread.';
      case 'summarize':
        return await this.deps.agent.getConversationDebug({ platform: evt.platform, address: evt.address });
    }
  }
}

type ParsedCommand = { name: 'help' | 'status' | 'reset' | 'summarize' };

function parseCommand(text: string): ParsedCommand | null {
  const lower = text.toLowerCase();
  if (lower === 'help') return { name: 'help' };
  if (lower === 'status') return { name: 'status' };
  if (lower === 'reset') return { name: 'reset' };
  if (lower === 'summarize') return { name: 'summarize' };
  return null;
}

