import type { KaytooConfig } from '../../../config.js';
import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import { queryPortscanCandidates } from '../../../opensearch/queries/index.js';
import type { SearchClient } from '../../../search/types.js';
import { windowRelative } from '../../../util/time.js';
import { assertIndexAllowed, clampBucketSize, type AgentPolicy } from '../../policy.js';
import { clampMinutesBack } from './common.js';

export async function portscanCandidatesTool(
  ctx: {
    client: SearchClient;
    fields: FieldPreference;
    policy: AgentPolicy;
    defaultIndex: string;
    thresholds: KaytooConfig['thresholds'];
  },
  args: Record<string, unknown>,
): Promise<unknown> {
  const index = typeof args.index === 'string' ? args.index : ctx.defaultIndex;
  assertIndexAllowed(index, ctx.policy);
  const minutesBack = clampMinutesBack(typeof args.minutesBack === 'number' ? args.minutesBack : 5, ctx.policy);
  const size = clampBucketSize(typeof args.size === 'number' ? args.size : 50, ctx.policy);
  const now = new Date();
  const window = windowRelative({ to: now, minutesBack });
  const rows = await queryPortscanCandidates({
    client: ctx.client,
    index,
    fields: ctx.fields,
    window,
    size,
  });
  const apply = args.applyInsightThresholds === true;
  const filtered = apply
    ? rows.filter(
        (r) =>
          r.distinctDstPorts >= ctx.thresholds.portscanDistinctDstPorts && r.packets >= ctx.thresholds.portscanMinPackets,
      )
    : rows;
  return {
    index,
    window,
    applyInsightThresholds: apply,
    thresholds: ctx.thresholds,
    rows: filtered,
  };
}
