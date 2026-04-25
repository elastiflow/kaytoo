import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldPreference } from '../src/opensearch/fieldCaps.js';
import type { SearchClient } from '../src/search/types.js';
import { DEFAULT_TEST_FLOW_FIELDS } from './fixtures/flowFields.js';

vi.mock('../src/opensearch/queries/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/opensearch/queries/shared.js')>();
  return { ...actual, timedSearch: vi.fn() };
});

import * as shared from '../src/opensearch/queries/shared.js';
import { queryTopDestinationsByFanIn } from '../src/opensearch/queries/fanIn.js';
import {
  queryNamespaceTrafficMatrix,
  queryProtocolNamespaceRollup,
} from '../src/opensearch/queries/namespaceProtocol.js';

const client = {} as SearchClient;
const fieldsWithNsNoProto: FieldPreference = (() => {
  const f = { ...DEFAULT_TEST_FLOW_FIELDS, clientNamespaceField: 'k8s.ns' };
  delete (f as { protoField?: string }).protoField;
  return f;
})();

beforeEach(() => vi.mocked(shared.timedSearch).mockReset());

describe('queryTopDestinationsByFanIn', () => {
  const fieldsFull: FieldPreference = {
    ...DEFAULT_TEST_FLOW_FIELDS,
    podNameField: 'pod.name',
    clientNamespaceField: 'k8s.ns',
  };
  const fanInBody = {
    aggregations: {
      by_dst: {
        buckets: [
          {
            key: '10.0.0.1',
            distinct_src_ips: { value: 5 },
            bytes: { value: 100 },
            doc_count: 10,
            distinct_pod_names: { value: 2 },
            distinct_client_namespaces: { value: 1 },
            example: { hits: { hits: [{ _source: { 'flow.bytes': 1 } }] } },
          },
        ],
      },
    },
  };

  it('maps buckets; internalDstOnly filter length', async () => {
    vi.mocked(shared.timedSearch).mockResolvedValue({ body: fanInBody } as never);
    const rows = await queryTopDestinationsByFanIn({
      client,
      index: 'i',
      fields: fieldsFull,
      minutesBack: 5,
      size: 10,
      internalDstOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dstIp: '10.0.0.1',
      distinctSourceIps: 5,
      bytes: 100,
      docCount: 10,
      distinctPodNamesApprox: 2,
      distinctClientNamespacesApprox: 1,
      sampleSource: { 'flow.bytes': 1 },
    });
    const q0 = vi.mocked(shared.timedSearch).mock.calls[0]![2] as { body: { query: { bool: { filter: unknown[] } } } };
    expect(q0.body.query.bool.filter).toHaveLength(2);

    vi.mocked(shared.timedSearch).mockResolvedValue({ body: fanInBody } as never);
    await queryTopDestinationsByFanIn({
      client,
      index: 'i',
      fields: DEFAULT_TEST_FLOW_FIELDS,
      minutesBack: 5,
      size: 10,
      internalDstOnly: false,
    });
    const q1 = vi.mocked(shared.timedSearch).mock.calls[1]![2] as { body: { query: { bool: { filter: unknown[] } } } };
    expect(q1.body.query.bool.filter).toHaveLength(1);
  });

  it('optional pod/ns cardinality omitted when fields lack them', async () => {
    vi.mocked(shared.timedSearch).mockResolvedValue({
      body: {
        aggregations: {
          by_dst: {
            buckets: [{ key: '1.1.1.1', distinct_src_ips: { value: 1 }, bytes: { value: 9 }, doc_count: 2 }],
          },
        },
      },
    } as never);
    const rows = await queryTopDestinationsByFanIn({
      client,
      index: 'i',
      fields: DEFAULT_TEST_FLOW_FIELDS,
      minutesBack: 3,
      size: 5,
      internalDstOnly: false,
    });
    expect(rows[0]!.distinctPodNamesApprox).toBeUndefined();
    expect(rows[0]!.distinctClientNamespacesApprox).toBeUndefined();
  });
});

describe('queryNamespaceTrafficMatrix', () => {
  it('no clientNamespaceField -> [] without search', async () => {
    await expect(
      queryNamespaceTrafficMatrix({
        client,
        index: 'i',
        fields: DEFAULT_TEST_FLOW_FIELDS,
        minutesBack: 5,
        namespaceTermsSize: 10,
      }),
    ).resolves.toEqual([]);
    expect(shared.timedSearch).not.toHaveBeenCalled();
  });

  it('maps internal vs external per namespace', async () => {
    vi.mocked(shared.timedSearch).mockResolvedValue({
      body: {
        aggregations: {
          by_ns: {
            buckets: [
              {
                key: 'ns1',
                internal: { sum_bytes: { value: 10 }, doc_count: 1 },
                external: { sum_bytes: { value: 20 }, doc_count: 2 },
              },
            ],
          },
        },
      },
    } as never);
    const rows = await queryNamespaceTrafficMatrix({
      client,
      index: 'i',
      fields: { ...DEFAULT_TEST_FLOW_FIELDS, clientNamespaceField: 'k8s.namespace' },
      minutesBack: 10,
      namespaceTermsSize: 50,
    });
    expect(rows).toEqual([
      { namespace: 'ns1', internalBytes: 10, externalBytes: 20, internalFlows: 1, externalFlows: 2 },
    ]);
  });
});

describe('queryProtocolNamespaceRollup', () => {
  it('missing proto or namespace -> []', async () => {
    await expect(
      queryProtocolNamespaceRollup({
        client,
        index: 'i',
        fields: fieldsWithNsNoProto,
        minutesBack: 1,
        protoTermsSize: 5,
        nsTermsSize: 5,
      }),
    ).resolves.toEqual([]);
    await expect(
      queryProtocolNamespaceRollup({
        client,
        index: 'i',
        fields: DEFAULT_TEST_FLOW_FIELDS,
        minutesBack: 1,
        protoTermsSize: 5,
        nsTermsSize: 5,
      }),
    ).resolves.toEqual([]);
    expect(shared.timedSearch).not.toHaveBeenCalled();
  });

  it('flattens proto x namespace', async () => {
    vi.mocked(shared.timedSearch).mockResolvedValue({
      body: {
        aggregations: {
          by_proto: {
            buckets: [
              {
                key: 'tcp',
                by_ns: { buckets: [{ key: 'alpha', sum_bytes: { value: 100 }, doc_count: 5 }] },
              },
            ],
          },
        },
      },
    } as never);
    const rows = await queryProtocolNamespaceRollup({
      client,
      index: 'i',
      fields: { ...DEFAULT_TEST_FLOW_FIELDS, clientNamespaceField: 'k8s.ns', protoField: 'l4.proto.name' },
      minutesBack: 15,
      protoTermsSize: 20,
      nsTermsSize: 30,
    });
    expect(rows).toEqual([{ protocol: 'tcp', namespace: 'alpha', bytes: 100, flows: 5 }]);
  });
});
