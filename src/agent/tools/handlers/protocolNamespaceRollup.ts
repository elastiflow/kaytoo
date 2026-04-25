import type { Client } from '@opensearch-project/opensearch';
import { queryProtocolNamespaceRollup } from '../../../opensearch/queries/index.js';
import { clampBucketSize, type AgentPolicy } from '../../policy.js';
import { resolveAggToolContext } from './common.js';

export async function protocolNamespaceRollupTool(
  ctx: { client: Client; policy: AgentPolicy; defaultIndex: string },
  args: Record<string, unknown>,
): Promise<unknown> {
  const { index, fields, minutesBack } = await resolveAggToolContext({
    ctx,
    args,
    defaultMinutesBack: 60,
    defaultSize: 15,
  });
  const protoTermsSize = clampBucketSize(
    typeof args.protoTermsSize === 'number' ? args.protoTermsSize : 15,
    ctx.policy,
  );
  const nsTermsSize = clampBucketSize(
    typeof args.namespaceTermsSize === 'number' ? args.namespaceTermsSize : 25,
    ctx.policy,
  );
  if (!fields.clientNamespaceField || !fields.protoField) {
    return {
      index,
      minutesBack,
      rows: [],
      note: 'Requires client namespace and protocol fields.',
    };
  }
  const rows = await queryProtocolNamespaceRollup({
    client: ctx.client,
    index,
    fields,
    minutesBack,
    protoTermsSize,
    nsTermsSize,
  });
  return { index, minutesBack, rows };
}
