import type { Client } from '@opensearch-project/opensearch';
import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import { queryRareDestinationsSignificantTerms } from '../../../opensearch/queries/index.js';
import { windowRelative } from '../../../util/time.js';
import { assertIndexAllowed, clampBucketSize, type AgentPolicy } from '../../policy.js';
import { clampMinutesBack } from './common.js';

export async function rareExternalDestinations(
  ctx: { client: Client; fields: FieldPreference; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const index = typeof args.index === 'string' ? args.index : ctx.defaultIndex;
  assertIndexAllowed(index, ctx.policy);
  const currentM = clampMinutesBack(typeof args.currentMinutesBack === 'number' ? args.currentMinutesBack : 15, ctx.policy);
  const backgroundM = clampMinutesBack(
    typeof args.backgroundMinutesBack === 'number' ? args.backgroundMinutesBack : 7 * 24 * 60,
    ctx.policy,
  );
  const size = clampBucketSize(typeof args.size === 'number' ? args.size : 15, ctx.policy);
  const now = new Date();
  const currentWindow = windowRelative({ to: now, minutesBack: currentM });
  const backgroundWindow = windowRelative({ to: now, minutesBack: backgroundM });
  const rows = await queryRareDestinationsSignificantTerms({
    client: ctx.client,
    index,
    fields: ctx.fields,
    window: currentWindow,
    backgroundWindow,
    size,
  });
  const apply = args.applyInsightThresholds === true;
  const filtered = apply ? rows.filter((r) => r.score >= 10) : rows;
  return {
    index,
    currentWindow,
    backgroundWindow,
    applyInsightThresholds: apply,
    rows: filtered,
    ...(apply ? { note: 'score >= 10' } : {}),
  };
}
