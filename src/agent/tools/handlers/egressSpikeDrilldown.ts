import type { Client } from '@opensearch-project/opensearch';
import type { KaytooConfig } from '../../../config.js';
import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import { assertIndexAllowed, clampBucketSize, type AgentPolicy } from '../../policy.js';
import { runEgressVsBaselineQuery } from './egressVsBaselineQuery.js';
import { topDestinationsForSource } from './topDestinationsForSource.js';

export async function egressSpikeDrilldownTool(
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
  const spikeTopK = clampBucketSize(typeof args.spikeTopK === 'number' ? args.spikeTopK : 3, ctx.policy);
  const destinationsPerSource = clampBucketSize(
    typeof args.destinationsPerSource === 'number' ? args.destinationsPerSource : 5,
    ctx.policy,
  );

  const { currentWindow, baselineWindow, currentM, rows } = await runEgressVsBaselineQuery({
    client: ctx.client,
    index,
    fields: ctx.fields,
    policy: ctx.policy,
    thresholds: ctx.thresholds,
    args,
  });

  const apply = args.applyInsightThresholds === true;
  let pool = apply ? rows.filter((r) => r.passesInsightThreshold) : [...rows];
  if (pool.length === 0 && apply) {
    pool = [...rows];
  }
  pool.sort((a, b) => {
    const ra = a.ratioVsExpected ?? -1;
    const rb = b.ratioVsExpected ?? -1;
    if (rb !== ra) return rb - ra;
    return b.currentBytes - a.currentBytes;
  });
  const picked = pool.slice(0, spikeTopK);

  const baseCtx = { client: ctx.client, fields: ctx.fields, policy: ctx.policy, defaultIndex: ctx.defaultIndex };
  const drilldown = await Promise.all(
    picked.map(async (row) => {
      const dest = (await topDestinationsForSource(baseCtx, {
        index,
        srcIp: row.srcIp,
        minutesBack: currentM,
        size: destinationsPerSource,
      })) as { buckets: Array<{ dstIp: string; bytes: number; docCount: number }> };
      return {
        srcIp: row.srcIp,
        vsBaseline: {
          currentBytes: row.currentBytes,
          baselineBytes: row.baselineBytes,
          expectedBytes: row.expectedBytes,
          ratioVsExpected: row.ratioVsExpected,
          passesInsightThreshold: row.passesInsightThreshold,
        },
        topDestinations: dest.buckets.map((b) => ({
          dstIp: b.dstIp,
          bytes: b.bytes,
          flows: b.docCount,
        })),
      };
    }),
  );

  return {
    index,
    currentWindow,
    baselineWindow,
    applyInsightThresholds: apply,
    spikeTopK,
    destinationsPerSource,
    drilldown,
  };
}
