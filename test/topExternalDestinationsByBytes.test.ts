import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import * as fieldCaps from '../src/opensearch/fieldCaps.js';
import { topExternalDestinationsByBytes } from '../src/agent/tools/handlers/topExternalDestinationsByBytes.js';

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

describe('topExternalDestinationsByBytes', () => {
  beforeEach(() => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({
      ...baseFields,
      podNameField: 'flow.client.k8s.pod.name',
      clientNamespaceField: 'flow.client.k8s.namespace.name',
      srcDisplayNameField: 'host.name',
    });
  });

  it('includes by_src nested aggs and maps topSources with labels', async () => {
    const capsFromFields = (fields: string[]) => ({
      body: { fields: Object.fromEntries((fields ?? []).map((f) => [f, { keyword: { aggregatable: true } }])) },
    });
    const client = {
      fieldCaps: vi.fn().mockImplementation((opts: { fields?: string[] }) =>
        Promise.resolve(capsFromFields(opts.fields ?? [])),
      ),
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: {
              buckets: [
                {
                  key: '203.0.113.9',
                  doc_count: 20,
                  sum_bytes: { value: 5000 },
                  top_ports: { buckets: [{ key: 443, doc_count: 10 }] },
                  top_src_pods: { buckets: [{ key: 'pod-x', doc_count: 5 }] },
                  top_src_namespaces: { buckets: [{ key: 'default', doc_count: 12 }] },
                  by_src: {
                    buckets: [
                      {
                        key: '192.168.1.50',
                        doc_count: 15,
                        sum_bytes: { value: 4000 },
                        src_top_pods: { buckets: [{ key: 'pod-x', doc_count: 15 }] },
                        src_top_namespaces: { buckets: [{ key: 'default', doc_count: 15 }] },
                        src_top_display_names: { buckets: [{ key: 'client-host', doc_count: 14 }] },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    };

    const out = (await topExternalDestinationsByBytes(
      { client: client as never, policy: defaultAgentPolicy, defaultIndex: index },
      {},
    )) as {
      destinations: Array<{
        dstIp: string;
        topSources: Array<{
          srcIp: string;
          bytes: number;
          flows: number;
          topPodNames?: { podName: string; docCount: number }[];
          topNamespaces?: { namespace: string; docCount: number }[];
          topSrcDisplayNames?: { displayName: string; docCount: number }[];
        }>;
      }>;
    };

    const req = client.search.mock.calls[0]?.[0] as {
      body?: { aggs?: { by_dst?: { aggs?: Record<string, unknown> } } };
    };
    expect(req.body?.aggs?.by_dst?.aggs?.by_src).toMatchObject({
      terms: { field: 'source.ip', size: 5, order: { sum_bytes: 'desc' } },
      aggs: expect.objectContaining({
        src_top_display_names: { terms: { field: 'host.name', size: 1 } },
        src_top_pods: { terms: { field: 'flow.client.k8s.pod.name', size: 1 } },
      }),
    });

    expect(out.destinations[0]?.dstIp).toBe('203.0.113.9');
    expect(out.destinations[0]?.topSources[0]).toEqual({
      srcIp: '192.168.1.50',
      bytes: 4000,
      flows: 15,
      topPodNames: [{ podName: 'pod-x', docCount: 15 }],
      topNamespaces: [{ namespace: 'default', docCount: 15 }],
      topSrcDisplayNames: [{ displayName: 'client-host', docCount: 14 }],
    });
  });

  it('omits src_top_display_names agg when display field matches pod field', async () => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({
      ...baseFields,
      podNameField: 'k8s.pod',
      clientNamespaceField: 'k8s.ns',
      srcDisplayNameField: 'k8s.pod',
    });
    const podCaps = {
      body: {
        fields: {
          'k8s.pod': { keyword: { aggregatable: true } },
          'k8s.pod.keyword': { keyword: { aggregatable: true } },
          'k8s.ns': { keyword: { aggregatable: true } },
          'dest.port': { keyword: { aggregatable: true } },
        },
      },
    };
    const client = {
      fieldCaps: vi.fn().mockResolvedValue(podCaps),
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: {
              buckets: [
                {
                  key: '198.51.100.1',
                  doc_count: 2,
                  sum_bytes: { value: 50 },
                  top_ports: { buckets: [] },
                  top_src_pods: { buckets: [] },
                  top_src_namespaces: { buckets: [] },
                  by_src: {
                    buckets: [
                      {
                        key: '10.0.0.2',
                        doc_count: 2,
                        sum_bytes: { value: 50 },
                        src_top_pods: { buckets: [{ key: 'p1', doc_count: 2 }] },
                        src_top_namespaces: { buckets: [] },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    };

    await topExternalDestinationsByBytes({ client: client as never, policy: defaultAgentPolicy, defaultIndex: index }, {});

    const req = client.search.mock.calls[0]?.[0] as {
      body?: { aggs?: { by_dst?: { aggs?: { by_src?: { aggs?: Record<string, unknown> } } } } };
    };
    expect(req.body?.aggs?.by_dst?.aggs?.by_src?.aggs?.src_top_display_names).toBeUndefined();
  });

  it('omits src_top_display_names agg when display field matches namespace field', async () => {
    vi.mocked(fieldCaps.chooseFields).mockResolvedValue({
      ...baseFields,
      podNameField: 'k8s.pod',
      clientNamespaceField: 'k8s.ns',
      srcDisplayNameField: 'k8s.ns',
    });
    const caps = {
      body: {
        fields: {
          'k8s.pod': { keyword: { aggregatable: true } },
          'k8s.ns': { keyword: { aggregatable: true } },
          'dest.port': { keyword: { aggregatable: true } },
        },
      },
    };
    const client = {
      fieldCaps: vi.fn().mockResolvedValue(caps),
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: {
              buckets: [
                {
                  key: '198.51.100.2',
                  doc_count: 1,
                  sum_bytes: { value: 10 },
                  top_ports: { buckets: [] },
                  top_src_pods: { buckets: [] },
                  top_src_namespaces: { buckets: [{ key: 'default', doc_count: 1 }] },
                  by_src: {
                    buckets: [
                      {
                        key: '10.0.0.3',
                        doc_count: 1,
                        sum_bytes: { value: 10 },
                        src_top_namespaces: { buckets: [{ key: 'default', doc_count: 1 }] },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    };

    await topExternalDestinationsByBytes({ client: client as never, policy: defaultAgentPolicy, defaultIndex: index }, {});

    const req = client.search.mock.calls[0]?.[0] as {
      body?: { aggs?: { by_dst?: { aggs?: { by_src?: { aggs?: Record<string, unknown> } } } } };
    };
    expect(req.body?.aggs?.by_dst?.aggs?.by_src?.aggs?.src_top_display_names).toBeUndefined();
  });
});
