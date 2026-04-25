import type { FieldPreference } from '../../../opensearch/fieldCaps.js';
import type { SearchClient } from '../../../search/types.js';
import { assertIndexAllowed, clampHits, type AgentPolicy } from '../../policy.js';
import { summarizeHits } from '../helpers.js';
import { clampMinutesBack } from './common.js';

export async function searchFlows(
  ctx: { client: SearchClient; fields: FieldPreference; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const index = typeof args.index === 'string' ? args.index : ctx.defaultIndex;
  assertIndexAllowed(index, ctx.policy);
  const minutesBack = clampMinutesBack(typeof args.minutesBack === 'number' ? args.minutesBack : 30, ctx.policy);
  const size = clampHits(typeof args.size === 'number' ? args.size : 10, ctx.policy);
  const query = args.query;
  if (!query || typeof query !== 'object') throw new Error('query must be an object');

  const { body } = await ctx.client.search({
    index,
    size,
    body: {
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: `now-${minutesBack}m`, lt: 'now' } } },
            query,
          ],
        },
      },
      sort: [{ '@timestamp': { order: 'desc' } }],
    },
  });

  return summarizeHits(body as unknown);
}
