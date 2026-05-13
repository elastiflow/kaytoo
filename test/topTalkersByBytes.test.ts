import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import * as fieldCaps from '../src/opensearch/fieldCaps.js';
import { topTalkersByBytes } from '../src/agent/tools/handlers/topTalkersByBytes.js';

vi.mock('../src/opensearch/fieldCaps.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/opensearch/fieldCaps.js')>();
  return { ...actual, chooseFields: vi.fn() };
});

describe('topTalkersByBytes', () => {
  beforeEach(() => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({
      bytesField: 'flow.bytes',
      srcIpField: 'source.ip',
      dstIpField: 'dest.ip',
      srcPortField: 'source.port',
      dstPortField: 'dest.port',
      srcDisplayNameField: 'host.name',
    });
  });

  it('adds top_display_names agg and topSrcDisplayNames on rows when display field is aggregatable', async () => {
    const fieldCapsResp = (fields: string[]) => ({
      body: {
        fields: Object.fromEntries(
          fields.map((f) => [f, { keyword: { aggregatable: true } }]),
        ),
      },
    });
    const client = {
      fieldCaps: vi.fn().mockImplementation((opts: { fields?: string[] }) =>
        Promise.resolve(fieldCapsResp(opts.fields ?? [])),
      ),
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_src: {
              buckets: [
                {
                  key: '192.168.1.1',
                  doc_count: 10,
                  sum_bytes: { value: 900 },
                  top_display_names: {
                    buckets: [{ key: 'workstation.local', doc_count: 9 }],
                  },
                },
              ],
            },
          },
        },
      }),
    };

    const out = (await topTalkersByBytes(
      { client: client as never, policy: defaultAgentPolicy, defaultIndex: 'elastiflow-flow-codex-*' },
      {},
    )) as {
      talkers: Array<{ srcIp: string; topSrcDisplayNames?: { displayName: string; docCount: number }[] }>;
    };

    const searchBody = client.search.mock.calls[0]?.[0] as { body?: { aggs?: { by_src?: { aggs?: unknown } } } };
    expect(searchBody.body?.aggs?.by_src?.aggs).toMatchObject({
      top_display_names: { terms: { field: 'host.name', size: 3 } },
    });
    expect(out.talkers[0]?.srcIp).toBe('192.168.1.1');
    expect(out.talkers[0]?.topSrcDisplayNames).toEqual([{ displayName: 'workstation.local', docCount: 9 }]);
  });

  it('omits top_display_names when it would duplicate the pod terms field', async () => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({
      bytesField: 'flow.bytes',
      srcIpField: 'source.ip',
      dstIpField: 'dest.ip',
      srcPortField: 'source.port',
      dstPortField: 'dest.port',
      podNameField: 'k8s.pod',
      srcDisplayNameField: 'k8s.pod',
    });
    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: { fields: { 'k8s.pod': { keyword: { aggregatable: true } }, 'k8s.pod.keyword': { keyword: { aggregatable: true } } } },
      }),
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_src: {
              buckets: [
                {
                  key: '10.0.0.1',
                  doc_count: 3,
                  sum_bytes: { value: 100 },
                  top_pods: { buckets: [{ key: 'pod-a', doc_count: 3 }] },
                },
              ],
            },
          },
        },
      }),
    };

    await topTalkersByBytes(
      { client: client as never, policy: defaultAgentPolicy, defaultIndex: 'elastiflow-flow-codex-*' },
      {},
    );

    const searchBody = client.search.mock.calls[0]?.[0] as { body?: { aggs?: { by_src?: { aggs?: Record<string, unknown> } } } };
    expect(searchBody.body?.aggs?.by_src?.aggs?.top_display_names).toBeUndefined();
  });
});
