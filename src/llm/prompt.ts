import type { Finding } from '../detectors/types.js';
import { KAYTOO_SLACK_SUMMARY_IDENTITY } from '../agent/prompts/intentMetadata.js';
import type { ChatMessage } from './types.js';

export function buildSlackSummaryPrompt(findings: Finding[]): ChatMessage[] {
  const systemLines = [
    `${KAYTOO_SLACK_SUMMARY_IDENTITY}.`,
    'You decide whether a network engineer would want a proactive Slack alert for these findings (noise vs actionable).',
    'If not worth alerting, set post to false (text may be empty). If worth alerting, set post to true and write concise Slack copy.',
    'Be specific, avoid jargon, avoid false certainty, and include suggested next checks when post is true.',
    'When evidence includes topDestinations, topDstPorts, topClientNamespaces, or topClientPods, use them so readers see where bytes went (IPs, ports) and which Kubernetes clients were involved when present.',
    'Output MUST be valid JSON: {"post":true|false,"text":"..."} with no extra keys. When post is false, use empty string for text.',
  ];
  const system: ChatMessage = {
    role: 'system',
    content: systemLines.join(' '),
  };

  const user: ChatMessage = {
    role: 'user',
    content: JSON.stringify(
      {
        task: 'Decide whether to post a proactive insight and write Slack message text if yes.',
        constraints: {
          maxLines: 12,
          format: 'Use short paragraphs and bullet points. No markdown tables. No emojis.',
        },
        findings,
      },
      null,
      2,
    ),
  };

  return [system, user];
}

