import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import { resolveToolIndexAndFields } from '../src/agent/tools/handlers/common.js';
import { chooseFields } from '../src/opensearch/fieldCaps.js';

vi.mock('../src/opensearch/fieldCaps.js', () => ({
  chooseFields: vi.fn(),
}));

const chooseFieldsMock = vi.mocked(chooseFields);

const fp = {
  bytesField: 'flow.bytes',
  srcIpField: 'flow.client.ip.addr',
  dstIpField: 'flow.server.ip.addr',
  srcPortField: 'flow.client.port',
  dstPortField: 'flow.server.port',
};

describe('resolveToolIndexAndFields', () => {
  beforeEach(() => {
    chooseFieldsMock.mockReset();
    chooseFieldsMock.mockResolvedValue(fp);
  });

  it('falls back to defaultIndex when args index is not allowed', async () => {
    const r = await resolveToolIndexAndFields({
      ctx: {
        client: {} as never,
        policy: defaultAgentPolicy,
        defaultIndex: 'elastiflow-flow-codex-*',
      },
      args: { index: 'your_index_name' },
    });
    expect(r.index).toBe('elastiflow-flow-codex-*');
    expect(chooseFieldsMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 'elastiflow-flow-codex-*' }),
    );
  });

  it('keeps an allowlisted index from args', async () => {
    const r = await resolveToolIndexAndFields({
      ctx: {
        client: {} as never,
        policy: defaultAgentPolicy,
        defaultIndex: 'elastiflow-flow-codex-*',
      },
      args: { index: 'elastiflow-flow-codex-*' },
    });
    expect(r.index).toBe('elastiflow-flow-codex-*');
  });
});
