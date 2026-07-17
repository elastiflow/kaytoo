import { chooseFields, type FieldPreference } from '../../../opensearch/fieldCaps.js';
import type { SearchClient } from '../../../search/types.js';
import type { AgentPolicy } from '../../policy.js';
import { assertIndexAllowed, clampBucketSize } from '../../policy.js';

export function clampMinutesBack(minutes: number, policy: AgentPolicy): number {
  const maxM = policy.maxLookbackDays * 24 * 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return 60;
  return Math.min(Math.floor(minutes), maxM);
}

function indexAllowedOrDefault(candidate: string, defaultIndex: string, policy: AgentPolicy): string {
  try {
    assertIndexAllowed(candidate, policy);
    return candidate;
  } catch {
    assertIndexAllowed(defaultIndex, policy);
    return defaultIndex;
  }
}

export async function resolveToolIndexAndFields(opts: {
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string };
  args: Record<string, unknown>;
}): Promise<{ index: string; fields: FieldPreference }> {
  const fromArgs = typeof opts.args.index === 'string' ? opts.args.index : undefined;
  const index = indexAllowedOrDefault(fromArgs ?? opts.ctx.defaultIndex, opts.ctx.defaultIndex, opts.ctx.policy);
  const fields = await chooseFields({ client: opts.ctx.client, index });
  return { index, fields };
}

export async function resolveAggToolContext(opts: {
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string };
  args: Record<string, unknown>;
  defaultMinutesBack: number;
  defaultSize: number;
}): Promise<{ index: string; fields: FieldPreference; minutesBack: number; size: number }> {
  const { index, fields } = await resolveToolIndexAndFields({ ctx: opts.ctx, args: opts.args });
  const minutesBack = clampMinutesBack(
    typeof opts.args.minutesBack === 'number' ? opts.args.minutesBack : opts.defaultMinutesBack,
    opts.ctx.policy,
  );
  const size = clampBucketSize(typeof opts.args.size === 'number' ? opts.args.size : opts.defaultSize, opts.ctx.policy);
  return { index, fields, minutesBack, size };
}
