import { queryNamespaceTrafficMatrix } from '../../../opensearch/queries/index.js';
import type { SearchClient } from '../../../search/types.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { resolveAggToolContext } from './common.js';

export async function namespaceTrafficMatrixTool(
  ctx: { client: SearchClient; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 25,
  });
  const namespaceTermsSize = clampBucketSize(
    typeof args.namespaceTermsSize === 'number' ? args.namespaceTermsSize : 25,
    ctx.policy,
  );
  if (!fields.clientNamespaceField) {
    return {
      index,
      minutesBack,
      rows: [],
      note: 'No client namespace field in mapping.',
    };
  }
  const rows = await queryNamespaceTrafficMatrix({
    client: ctx.client,
    index,
    fields,
    minutesBack,
    namespaceTermsSize,
  });
  return { index, minutesBack, rows, availabilityZoneField: fields.availabilityZoneField ?? null };
}
