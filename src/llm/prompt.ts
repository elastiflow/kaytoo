import type { Finding } from '../detectors/types.js';
import { KAYTOO_SLACK_SUMMARY_IDENTITY } from '../agent/prompts/intentMetadata.js';
import type { ChatMessage } from './types.js';

export function buildSlackSummaryPrompt(findings: Finding[]): ChatMessage[] {
  const systemLines = [
    `${KAYTOO_SLACK_SUMMARY_IDENTITY}.`,
    'Write concise Slack posts about network flow security/ops insights.',
    'Be specific, avoid jargon, avoid false certainty, and include suggested next checks.',
    'Output MUST be valid JSON: {"text":"..."} with no extra keys.',
  ];
  const system: ChatMessage = {
    role: 'system',
    content: systemLines.join(' '),
  };

  const user: ChatMessage = {
    role: 'user',
    content: JSON.stringify(
      {
        task: 'Summarize findings into a single Slack message.',
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

