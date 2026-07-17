import type { Finding } from '../detectors/types.js';
import { KAYTOO_SLACK_SUMMARY_IDENTITY } from '../agent/prompts/intentMetadata.js';
import type { ChatMessage } from './types.js';

export function buildSlackSummaryPrompt(findings: Finding[]): ChatMessage[] {
  const systemLines = [
    `${KAYTOO_SLACK_SUMMARY_IDENTITY}.`,
    'You write optional proactive network change notes for chat (observability, not incident response).',
    'Decide noise vs actionable: set post false (empty text) unless a network engineer would want a nudge.',
    'Set post false when volume is dominated by CDN/cloud media/update edges (Akamai, CloudFront, Fastly, Google, Apple, etc.) or looks like ordinary streaming/browsing.',
    'When post is true: concise copy, no jargon, no false certainty; include short next checks.',
    'Prefer structured evidence (comparisonFrame, volumeSummary, bytesHuman, window, topDestinations) over guessing.',
    'Use dstEndpointLabel, dstDisplayName, topDstPorts.protocol, and K8s fields when present; prefer Name (IP) over raw addresses.',
    'Frame as "busy vs this host recent average" — never call it exfiltration, unauthorized transfer, or urge isolation unless evidence shows a rare/unknown non-CDN peer.',
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

