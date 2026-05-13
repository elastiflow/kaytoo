import type { EgressInsightMode } from './egressInsightPolicy.js';
import { formatBytesHuman } from '../util/formatInsight.js';

export function buildEgressComparisonFrame(
  mode: EgressInsightMode,
  currentMinutes: number,
  baselineMinutes: number,
): string {
  const scale = (currentMinutes / baselineMinutes).toFixed(4);
  const label = mode === 'spike' ? 'Spike' : 'Primary';
  return `${label}: ${currentMinutes}m vs ${baselineMinutes}m baseline (scale ${scale}).`;
}

export function buildEgressVolumeSummary(bytes: number, expectedBytes: number, ratio: number): string {
  if (!(expectedBytes > 0)) return `${formatBytesHuman(bytes)} observed (no baseline for comparison).`;
  const r = Number.isFinite(ratio) ? ratio.toFixed(1) : Number.isNaN(ratio) ? 'n/a' : 'high';
  return `${formatBytesHuman(bytes)} vs ~${formatBytesHuman(expectedBytes)} expected (${r}x).`;
}
