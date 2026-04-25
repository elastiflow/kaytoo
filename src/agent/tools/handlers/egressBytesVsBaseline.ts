import type { Client } from '@opensearch-project/opensearch';
import type { KaytooConfig } from '../../../config.js';
import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import { assertIndexAllowed, type AgentPolicy } from '../../policy.js';
import { runEgressVsBaselineQuery } from './egressVsBaselineQuery.js';

export async function egressBytesVsBaselineTool(
  ctx: {
    client: Client;
    fields: FieldPreference;
    policy: AgentPolicy;
    defaultIndex: string;
    thresholds: KaytooConfig['thresholds'];
  },
  args: Record<string, unknown>,
): Promise<unknown> {
  const index = typeof args.index === 'string' ? args.index : ctx.defaultIndex;
  assertIndexAllowed(index, ctx.policy);
  const { currentWindow, baselineWindow, rows } = await runEgressVsBaselineQuery({
    client: ctx.client,
    index,
    fields: ctx.fields,
    policy: ctx.policy,
    thresholds: ctx.thresholds,
    args,
  });
  const apply = args.applyInsightThresholds === true;
  const filtered = apply ? rows.filter((r) => r.passesInsightThreshold) : rows;
  return {
    index,
    currentWindow,
    baselineWindow,
    applyInsightThresholds: apply,
    sources: filtered,
    note: 'expectedBytes scales by window length; threshold uses EGRESS_MIN_BYTES and EGRESS_MULTIPLIER.',
  };
}
