import type { Client } from '@opensearch-project/opensearch';
import { queryTopDestinationsByFanIn } from '../../../opensearch/queries/index.js';
import type { AgentPolicy } from '../../policy.js';
import { resolveAggToolContext } from './common.js';

export async function topServiceFanIn(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack, size } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 1440,
    defaultSize: 10,
  });
  const internalDstOnly = typeof args.internalDstOnly === 'boolean' ? args.internalDstOnly : true;

  const destinations = await queryTopDestinationsByFanIn({
    client: ctx.client,
    index,
    fields,
    minutesBack,
    size,
    internalDstOnly,
  });

  return {
    index,
    minutesBack,
    internalDstOnly,
    note: 'Fan-in = distinct client IPs per destination; pod/namespace counts are approximate.',
    destinations,
  };
}
