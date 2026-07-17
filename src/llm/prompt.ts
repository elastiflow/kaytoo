import type { Finding } from '../detectors/types.js';
import { KAYTOO_SLACK_SUMMARY_IDENTITY } from '../agent/prompts/intentMetadata.js';
import type { ChatMessage } from './types.js';

export function buildSlackSummaryPrompt(findings: Finding[]): ChatMessage[] {
  const systemLines = [
    `${KAYTOO_SLACK_SUMMARY_IDENTITY}.`,
    'Decide whether a network engineer would want a proactive chat note (noise vs actionable).',
    'If not worth posting, set post to false with empty text. If posting: concise copy, no jargon, no false certainty, short next checks.',
    'Prefer structured evidence (comparisonFrame, volumeSummary, bytesHuman, window, topDestinations); prefer Name (IP) over raw addresses.',
    'Decline ordinary streaming/CDN/browsing volume. Prefer rare destinations and port-scan evidence over raw byte spikes.',
    'Do not frame volume as exfiltration or urge isolation.',
    'Output MUST be valid JSON: {"post":true|false,"text":"..."} with no extra keys.',
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
