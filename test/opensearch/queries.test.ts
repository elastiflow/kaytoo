import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEST_FLOW_FIELDS } from '../fixtures/flowFields.js';

vi.mock('@opensearch-project/opensearch', () => {
  const Client = vi.fn(function (this: unknown, opts: unknown) {
    return { __opts: opts };
  });
  return { Client };
});

describe('opensearch helpers', () => {
  it('createSearchClient passes auth and toggles tlsInsecure (opensearch backend)', async () => {
    const { createSearchClient } = await import('../../src/search/client.js');
    const { Client } = (await import('@opensearch-project/opensearch')) as unknown as { Client: ReturnType<typeof vi.fn> };

    await createSearchClient({
      backend: 'opensearch',
      url: 'https://os.example.com',
      username: 'u',
      password: 'p',
      tlsInsecure: false,
      indexPattern: 'x',
    });
    expect(Client).toHaveBeenCalledWith({
      node: 'https://os.example.com',
      auth: { username: 'u', password: 'p' },
    });

    Client.mockClear();
    await createSearchClient({
      backend: 'opensearch',
      url: 'https://os.example.com',
      username: 'u',
      password: 'p',
      tlsInsecure: true,
      indexPattern: 'x',
    });
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: { rejectUnauthorized: false },
      }),
    );
  });

  it('chooseFields picks the first matching candidate from fieldCaps', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'network.bytes': {},
            'source.ip': {},
            'destination.ip': {},
            'source.port': {},
            'destination.port': {},
            'network.transport': {},
            'kubernetes.pod.name': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.bytesField).toBe('network.bytes');
    expect(pref.srcIpField).toBe('source.ip');
    expect(pref.dstIpField).toBe('destination.ip');
    expect(pref.protoField).toBe('network.transport');
    expect(pref.podNameField).toBe('kubernetes.pod.name');
  });

  it('chooseFields picks optional client namespace field', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
            'flow.client.ip.addr': {},
            'flow.server.ip.addr': {},
            'flow.client.port': {},
            'flow.server.port': {},
            'l4.proto.name': {},
            'kubernetes.namespace': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.clientNamespaceField).toBe('kubernetes.namespace');
  });

  it('chooseFields prefers Mermin source.k8s pod name over flow.client when both exist', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
            'flow.client.ip.addr': {},
            'flow.server.ip.addr': {},
            'flow.client.port': {},
            'flow.server.port': {},
            'l4.proto.name': {},
            'source.k8s.pod.name': {},
            'flow.client.k8s.pod.name': {},
            'source.k8s.namespace.name': {},
            'flow.client.k8s.namespace.name': {},
            'kubernetes.pod.name': {},
            'kubernetes.namespace': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.podNameField).toBe('source.k8s.pod.name');
    expect(pref.clientNamespaceField).toBe('source.k8s.namespace.name');
  });

  it('chooseFields prefers legacy flow.client k8s fields when source.k8s is absent', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
            'flow.client.ip.addr': {},
            'flow.server.ip.addr': {},
            'flow.client.port': {},
            'flow.server.port': {},
            'l4.proto.name': {},
            'flow.client.k8s.pod.name': {},
            'flow.client.k8s.namespace.name': {},
            // also present but should not be preferred
            'kubernetes.pod.name': {},
            'kubernetes.namespace': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.podNameField).toBe('flow.client.k8s.pod.name');
    expect(pref.clientNamespaceField).toBe('flow.client.k8s.namespace.name');
  });

  it('chooseFields falls back to the first candidate when none exist', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {},
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.bytesField).toBe('flow.bytes');
    expect(pref.srcIpField).toBe('flow.client.ip.addr');
    expect(pref.dstIpField).toBe('flow.server.ip.addr');
    expect(pref.protoField).toBe('l4.proto.name');
    expect(pref.clientNamespaceField).toBeUndefined();
  });

  it('chooseFields resolves flow host fields for display when k8s names absent', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
            'flow.client.ip.addr': {},
            'flow.server.ip.addr': {},
            'flow.client.port': {},
            'flow.server.port': {},
            'l4.proto.name': {},
            'flow.client.host.name': {},
            'flow.server.host.name': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.srcDisplayNameField).toBe('flow.client.host.name');
    expect(pref.dstDisplayNameField).toBe('flow.server.host.name');
  });

  it('chooseFields prefers flow.client.ip over flow.src.ip when both exist', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
            'flow.client.ip.addr': {},
            'flow.src.ip.addr': {},
            'flow.server.ip.addr': {},
            'flow.dst.ip.addr': {},
            'flow.client.port': {},
            'flow.server.port': {},
            'l4.proto.name': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.srcIpField).toBe('flow.client.ip.addr');
    expect(pref.dstIpField).toBe('flow.server.ip.addr');
  });

  it('chooseFields falls back to flow src/dst ip when client/server ip absent', async () => {
    const { chooseFields } = await import('../../src/opensearch/fieldCaps.js');

    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
            'flow.src.ip.addr': {},
            'flow.dst.ip.addr': {},
            'flow.client.port': {},
            'flow.server.port': {},
            'l4.proto.name': {},
          },
        },
      }),
    };

    const pref = await chooseFields({ client: client as never, index: 'idx-*' });
    expect(pref.srcIpField).toBe('flow.src.ip.addr');
    expect(pref.dstIpField).toBe('flow.dst.ip.addr');
  });

  it('queryTopDestinationsByFanIn maps aggregations and optional internal filter', async () => {
    const { queryTopDestinationsByFanIn } = await import('../../src/opensearch/queries/index.js');

    const fields = {
      ...DEFAULT_TEST_FLOW_FIELDS,
      podNameField: 'kubernetes.pod.name',
      clientNamespaceField: 'kubernetes.namespace',
    };

    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: {
              buckets: [
                {
                  key: '10.96.0.5',
                  doc_count: 100,
                  distinct_src_ips: { value: 42 },
                  distinct_pod_names: { value: 9 },
                  distinct_client_namespaces: { value: 3 },
                  bytes: { value: 1e6 },
                  example: {
                    hits: { hits: [{ _source: { 'flow.server.ip.addr': '10.96.0.5', 'flow.client.ip.addr': '10.1.2.3' } }] },
                  },
                },
              ],
            },
          },
        },
      }),
    };

    const rows = await queryTopDestinationsByFanIn({
      client: client as never,
      index: 'i-*',
      fields,
      minutesBack: 60,
      size: 5,
      internalDstOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dstIp: '10.96.0.5',
      distinctSourceIps: 42,
      distinctPodNamesApprox: 9,
      distinctClientNamespacesApprox: 3,
      bytes: 1e6,
      docCount: 100,
    });
    expect(rows[0]?.sampleSource).toEqual({
      'flow.server.ip.addr': '10.96.0.5',
      'flow.client.ip.addr': '10.1.2.3',
    });

    const call0 = client.search.mock.calls[0];
    expect(call0).toBeDefined();
    const req = call0![0] as { body: { query: { bool: { filter: unknown[] } } } };
    expect(req.body.query.bool.filter).toHaveLength(2);

    client.search.mockResolvedValueOnce({
      body: {
        aggregations: {
          by_dst: { buckets: [] },
        },
      },
    });
    await queryTopDestinationsByFanIn({
      client: client as never,
      index: 'i-*',
      fields,
      minutesBack: 30,
      size: 5,
      internalDstOnly: false,
    });
    const call1 = client.search.mock.calls[1];
    expect(call1).toBeDefined();
    const req2 = call1![0] as { body: { query: { bool: { filter: unknown[] } } } };
    expect(req2.body.query.bool.filter).toHaveLength(1);
  });

  it('internalDestinationIpBool and namespace traffic matrix search shape', async () => {
    const { internalDestinationIpBool, queryNamespaceTrafficMatrix } = await import('../../src/opensearch/queries/index.js');

    expect(internalDestinationIpBool('flow.server.ip.addr')).toMatchObject({
      bool: { minimum_should_match: 1 },
    });

    const fields = {
      ...DEFAULT_TEST_FLOW_FIELDS,
      clientNamespaceField: 'kubernetes.namespace',
    };

    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_ns: {
              buckets: [
                {
                  key: 'default',
                  doc_count: 500,
                  internal: { doc_count: 400, sum_bytes: { value: 1e6 } },
                  external: { doc_count: 100, sum_bytes: { value: 2e6 } },
                },
              ],
            },
          },
        },
      }),
    };

    const rows = await queryNamespaceTrafficMatrix({
      client: client as never,
      index: 'i-*',
      fields,
      minutesBack: 30,
      namespaceTermsSize: 10,
    });
    expect(rows[0]).toMatchObject({
      namespace: 'default',
      internalBytes: 1e6,
      externalBytes: 2e6,
      internalFlows: 400,
      externalFlows: 100,
    });
  });

  it('queryProtocolNamespaceRollup flattens nested buckets', async () => {
    const { queryProtocolNamespaceRollup } = await import('../../src/opensearch/queries/index.js');

    const fields = {
      ...DEFAULT_TEST_FLOW_FIELDS,
      clientNamespaceField: 'kubernetes.namespace',
    };

    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_proto: {
              buckets: [
                {
                  key: 'tcp',
                  doc_count: 50,
                  by_ns: {
                    buckets: [
                      { key: 'kube-system', doc_count: 10, sum_bytes: { value: 99 } },
                      { key: 'default', doc_count: 5, sum_bytes: { value: 3 } },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    };

    const rows = await queryProtocolNamespaceRollup({
      client: client as never,
      index: 'i-*',
      fields,
      minutesBack: 15,
      protoTermsSize: 5,
      nsTermsSize: 10,
    });
    expect(rows).toEqual([
      { protocol: 'tcp', namespace: 'kube-system', bytes: 99, flows: 10 },
      { protocol: 'tcp', namespace: 'default', bytes: 3, flows: 5 },
    ]);
  });

  it('queries map buckets and tolerate missing/invalid bodies', async () => {
    const { queryTopEgressBySource, queryPortscanCandidates, queryRareDestinationsSignificantTerms } = await import(
      '../../src/opensearch/queries/index.js'
    );

    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_src: {
              buckets: [
                { key: '1.2.3.4', bytes: { value: 10 } },
                { key: '5.6.7.8', bytes: { value: 'nope' } },
              ],
            },
          },
        },
      }),
    };

    const fields = {
      bytesField: 'b',
      srcIpField: 's',
      dstIpField: 'd',
      srcPortField: 'sp',
      dstPortField: 'dp',
      protoField: 'p',
    };

    const egress = await queryTopEgressBySource({
      client: client as never,
      index: 'i',
      fields,
      window: { from: 'a', to: 'b' },
      size: 2,
    });
    expect(egress).toEqual([
      { srcIp: '1.2.3.4', bytes: 10 },
      { srcIp: '5.6.7.8', bytes: 0 },
    ]);

    client.search.mockResolvedValueOnce({
      body: {
        aggregations: {
          by_src: {
            buckets: [{ key: '1.2.3.4', distinct_dst_ports: { value: 7 }, packets: { value: 2 }, bytes: { value: 3 } }],
          },
        },
      },
    });
    const portscan = await queryPortscanCandidates({
      client: client as never,
      index: 'i',
      fields,
      window: { from: 'a', to: 'b' },
      size: 1,
    });
    expect(portscan[0]).toEqual({ srcIp: '1.2.3.4', distinctDstPorts: 7, packets: 2, bytes: 3 });

    client.search.mockResolvedValueOnce({ body: null });
    const empty = await queryRareDestinationsSignificantTerms({
      client: client as never,
      index: 'i',
      fields,
      window: { from: 'a', to: 'b' },
      backgroundWindow: { from: 'c', to: 'd' },
      size: 10,
    });
    expect(empty).toEqual([]);

    client.search.mockResolvedValueOnce({
      body: {
        aggregations: {
          sig_dests: {
            buckets: [
              { key: '9.9.9.9', score: 12, doc_count: 3, bytes: { value: 100 } },
              { key: 123, score: 1, doc_count: 1, bytes: { value: 1 } },
            ],
          },
        },
      },
    });
    const rare = await queryRareDestinationsSignificantTerms({
      client: client as never,
      index: 'i',
      fields,
      window: { from: 'a', to: 'b' },
      backgroundWindow: { from: 'c', to: 'd' },
      size: 10,
    });
    expect(rare).toEqual([{ dstIp: '9.9.9.9', score: 12, docCount: 3, bytes: 100 }]);
  });

  it('queryTopEgressBySource maps top_src_display when srcDisplayNameField is set', async () => {
    const { queryTopEgressBySource } = await import('../../src/opensearch/queries/index.js');

    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_src: {
              buckets: [
                {
                  key: '1.1.1.1',
                  bytes: { value: 100 },
                  top_src_display: { buckets: [{ key: 'pod-x', doc_count: 1, lbl_bytes: { value: 100 } }] },
                },
              ],
            },
          },
        },
      }),
    };

    const fields = {
      bytesField: 'b',
      srcIpField: 's',
      dstIpField: 'd',
      srcPortField: 'sp',
      dstPortField: 'dp',
      protoField: 'p',
      srcDisplayNameField: 'sn',
    };

    const rows = await queryTopEgressBySource({
      client: client as never,
      index: 'i',
      fields,
      window: { from: 'a', to: 'b' },
      size: 5,
    });
    expect(rows).toEqual([{ srcIp: '1.1.1.1', bytes: 100, srcDisplayName: 'pod-x' }]);
  });

  it('queryTopEgressBySource filters to external destinations', async () => {
    const { queryTopEgressBySource } = await import('../../src/opensearch/queries/index.js');
    const client = {
      search: vi.fn().mockResolvedValue({ body: { aggregations: { by_src: { buckets: [] } } } }),
    };
    const fields = {
      bytesField: 'b',
      srcIpField: 's',
      dstIpField: 'd',
      srcPortField: 'sp',
      dstPortField: 'dp',
      protoField: 'p',
    };
    await queryTopEgressBySource({
      client: client as never,
      index: 'i',
      fields,
      window: { from: 'a', to: 'b' },
      size: 5,
    });
    const body = client.search.mock.calls[0]![0].body as {
      query: { bool: { filter: unknown[] } };
    };
    expect(body.query.bool.filter).toHaveLength(2);
    expect(JSON.stringify(body.query.bool.filter[1])).toContain('must_not');
  });

  it('queryTopEgressBySource returns [] when aggregation shape is missing', async () => {
    const { queryTopEgressBySource } = await import('../../src/opensearch/queries/index.js');

    const fields = {
      bytesField: 'b',
      srcIpField: 's',
      dstIpField: 'd',
      srcPortField: 'sp',
      dstPortField: 'dp',
      protoField: 'p',
    };

    const bodies = [null, {}, { aggregations: {} }, { aggregations: { by_src: {} } }, { aggregations: { by_src: { buckets: {} } } }];
    for (const body of bodies) {
      const client = { search: vi.fn().mockResolvedValue({ body }) };
      const rows = await queryTopEgressBySource({
        client: client as never,
        index: 'i',
        fields,
        window: { from: 'a', to: 'b' },
        size: 10,
      });
      expect(rows).toEqual([]);
    }
  });
});

