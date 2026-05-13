import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import * as fieldCaps from '../src/opensearch/fieldCaps.js';
import { topTalkersByBytes } from '../src/agent/tools/handlers/topTalkersByBytes.js';

vi.mock('../src/opensearch/fieldCaps.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/opensearch/fieldCaps.js')>();
  return { ...actual, chooseFields: vi.fn() };
});

const index = 'elastiflow-flow-codex-*';
const baseFields = {
  bytesField: 'flow.bytes',
  srcIpField: 'source.ip',
  dstIpField: 'dest.ip',
  srcPortField: 'source.port',
  dstPortField: 'dest.port',
};

describe('topTalkersByBytes', () => {
  beforeEach(() => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({ ...baseFields, srcDisplayNameField: 'host.name' });
  });

  it('adds top_display_names and topSrcDisplayNames when display field aggregates', async () => {
    const capsFromFields = (fields: string[]) => ({
      body: { fields: Object.fromEntries(fields.map((f) => [f, { keyword: { aggregatable: true } }])) },
    });
    const client = {
      fieldCaps: vi.fn().mockImplementation((opts: { fields?: string[] }) =>
        Promise.resolve(capsFromFields(opts.fields ?? [])),
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
                  top_display_names: { buckets: [{ key: 'workstation.local', doc_count: 9 }] },
                },
              ],
            },
          },
        },
      }),
    };

    const out = (await topTalkersByBytes({ client: client as never, policy: defaultAgentPolicy, defaultIndex: index }, {})) as {
      talkers: Array<{ srcIp: string; topSrcDisplayNames?: { displayName: string; docCount: number }[] }>;
    };

    const body = client.search.mock.calls[0]?.[0] as { body?: { aggs?: { by_src?: { aggs?: unknown } } } };
    expect(body.body?.aggs?.by_src?.aggs).toMatchObject({
      top_display_names: { terms: { field: 'host.name', size: 3 } },
    });
    expect(out.talkers[0]?.srcIp).toBe('192.168.1.1');
    expect(out.talkers[0]?.topSrcDisplayNames).toEqual([{ displayName: 'workstation.local', docCount: 9 }]);
  });

  it('skips top_display_names when same field as pod terms', async () => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({
      ...baseFields,
      podNameField: 'k8s.pod',
      srcDisplayNameField: 'k8s.pod',
    });
    const podCaps = {
      body: {
        fields: {
          'k8s.pod': { keyword: { aggregatable: true } },
          'k8s.pod.keyword': { keyword: { aggregatable: true } },
        },
      },
    };
    const client = {
      fieldCaps: vi.fn().mockResolvedValue(podCaps),
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

    await topTalkersByBytes({ client: client as never, policy: defaultAgentPolicy, defaultIndex: index }, {});

    const body = client.search.mock.calls[0]?.[0] as { body?: { aggs?: { by_src?: { aggs?: Record<string, unknown> } } } };
    expect(body.body?.aggs?.by_src?.aggs?.top_display_names).toBeUndefined();
  });
});
