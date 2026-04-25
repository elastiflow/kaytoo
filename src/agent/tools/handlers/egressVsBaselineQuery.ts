import type { KaytooConfig } from '../../../config.js';
import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import type { EgressVsBaselineRow } from '../../../opensearch/egressBaseline.js';
import { computeEgressVsBaselineRows } from '../../../opensearch/egressBaseline.js';
import { queryTopEgressBySource } from '../../../opensearch/queries/index.js';
import type { SearchClient } from '../../../search/types.js';
import { windowRelative } from '../../../util/time.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { clampMinutesBack } from './common.js';

export type EgressVsBaselineQueryResult = {
  index: string;
  currentM: number;
  baselineM: number;
  currentWindow: ReturnType<typeof windowRelative>;
  baselineWindow: ReturnType<typeof windowRelative>;
  rows: EgressVsBaselineRow[];
};

/** Shared current/baseline egress query + ratio rows for egressBytesVsBaseline and egressSpikeDrilldown. */
export async function runEgressVsBaselineQuery(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  policy: AgentPolicy;
  thresholds: KaytooConfig['thresholds'];
  args: Record<string, unknown>;
}): Promise<EgressVsBaselineQueryResult> {
  const { client, index, fields, policy, thresholds, args } = opts;
  const currentM = clampMinutesBack(
    typeof args.currentMinutesBack === 'number' ? args.currentMinutesBack : 15,
    policy,
  );
  const baselineM = clampMinutesBack(
    typeof args.baselineMinutesBack === 'number' ? args.baselineMinutesBack : 24 * 60,
    policy,
  );
  const currentTop = clampBucketSize(
    typeof args.currentTopSources === 'number' ? args.currentTopSources : 50,
    policy,
  );
  const baselineTop = clampBucketSize(
    typeof args.baselineTopSources === 'number' ? args.baselineTopSources : 200,
    policy,
  );
  const now = new Date();
  const currentWindow = windowRelative({ to: now, minutesBack: currentM });
  const baselineWindow = windowRelative({ to: now, minutesBack: baselineM });
  const [current, baseline] = await Promise.all([
    queryTopEgressBySource({
      client,
      index,
      fields,
      window: currentWindow,
      size: currentTop,
    }),
    queryTopEgressBySource({
      client,
      index,
      fields,
      window: baselineWindow,
      size: baselineTop,
    }),
  ]);
  const rows = computeEgressVsBaselineRows({
    current,
    baseline,
    currentMinutes: currentM,
    baselineMinutes: baselineM,
    egressMultiplier: thresholds.egressMultiplier,
    egressMinBytes: thresholds.egressMinBytes,
  });
  return { index, currentM, baselineM, currentWindow, baselineWindow, rows };
}
