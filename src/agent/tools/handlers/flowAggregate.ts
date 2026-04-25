import type { Client } from '@opensearch-project/opensearch';
import type { AgentPolicy } from '../../policy.js';
import { executeFlowAggregate, validateFlowAggregateAggs } from '../../flowAggregate.js';
import { resolveAggToolContext } from './common.js';

export async function flowAggregateTool(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const aggsIn = args.aggs;
  if (!aggsIn || typeof aggsIn !== 'object' || Array.isArray(aggsIn)) {
    throw new Error('flowAggregate requires aggs object');
  }
  const { index, fields, minutesBack } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 10,
  });
  const validated = validateFlowAggregateAggs(aggsIn as Record<string, unknown>, ctx.policy, fields);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const body = await executeFlowAggregate({
    client: ctx.client,
    index,
    defaultIndex: ctx.defaultIndex,
    minutesBack,
    aggs: validated.aggs,
    policy: ctx.policy,
  });
  return { index, minutesBack, aggNodeCount: validated.nodeCount, result: body };
}
