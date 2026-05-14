import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '../src/detectors/types.js';
import type { FieldPreference } from '../src/opensearch/fieldCaps.js';
import { enrichEgressFinding, enrichInsightsEgressBatch } from '../src/insights/enrichEgressEvidence.js';
import type { SearchClient } from '../src/search/types.js';

const fields: FieldPreference = {
  bytesField: 'flow.bytes',
  srcIpField: 'flow.client.ip.addr',
  dstIpField: 'flow.server.ip.addr',
  srcPortField: 'flow.client.port',
  dstPortField: 'flow.server.port',
  clientNamespaceField: 'flow.client.k8s.namespace.name',
  podNameField: 'flow.client.k8s.pod.name',
};

describe('enrichEgressFinding', () => {
  it('passes through non-egress findings', async () => {
    const f: Finding = {
      id: 'x',
      kind: 'port_scan',
      severity: 'high',
      title: 't',
      summary: 's',
      evidence: {},
      window: { from: '2020-01-01T00:00:00.000Z', to: '2020-01-01T00:15:00.000Z' },
    };
    const client = { search: vi.fn() } as unknown as SearchClient;
    const out = await enrichEgressFinding({ client, index: 'ix', fields, finding: f });
    expect(out).toBe(f);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('enriches opensearch_anomaly like egress when contributingSrcIps present', async () => {
    const f: Finding = {
      id: 'os',
      kind: 'opensearch_anomaly',
      severity: 'high',
      title: 't',
      summary: 's',
      evidence: { contributingSrcIps: ['10.0.0.1'] },
      window: { from: '2020-01-01T00:00:00.000Z', to: '2020-01-01T00:15:00.000Z' },
    };
    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: { buckets: [{ key: '8.8.8.8', doc_count: 1, dst_bytes: { value: 10 } }] },
            by_dport: { buckets: [] },
          },
        },
      }),
    } as unknown as SearchClient;
    const out = await enrichEgressFinding({ client, index: 'ix', fields, finding: f });
    expect(client.search).toHaveBeenCalled();
    expect(out.evidence['topDestinations']).toBeDefined();
  });

  it('merges aggregation results into evidence', async () => {
    const finding: Finding = {
      id: 'egress:10.0.0.1',
      kind: 'egress_anomaly',
      severity: 'high',
      title: 't',
      summary: 's',
      evidence: { contributingSrcIps: ['10.0.0.1'] },
      window: { from: '2020-01-01T00:00:00.000Z', to: '2020-01-01T00:15:00.000Z' },
    };
    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: { buckets: [{ key: '8.8.8.8', doc_count: 2, dst_bytes: { value: 99 } }] },
            by_dport: {
              buckets: [{ key: 443, doc_count: 1, pbytes: { value: 88 } }],
            },
            by_client_ns: { buckets: [{ key: 'default', doc_count: 1, nb: { value: 77 } }] },
            by_client_pod: { buckets: [{ key: 'pod-a', doc_count: 1, pb: { value: 66 } }] },
          },
        },
      }),
    } as unknown as SearchClient;

    const out = await enrichEgressFinding({ client, index: 'ix', fields, finding });

    expect(client.search).toHaveBeenCalledTimes(1);
    expect(out.evidence['topDestinations']).toEqual([
      { dstIp: '8.8.8.8', dstEndpointLabel: '8.8.8.8', bytes: 99, flows: 2 },
    ]);
    expect(out.evidence['topDstPorts']).toEqual([{ port: 443, bytes: 88, flows: 1 }]);
    expect(out.evidence['topClientNamespaces']).toEqual([{ namespace: 'default', bytes: 77, flows: 1 }]);
    expect(out.evidence['topClientPods']).toEqual([{ podName: 'pod-a', bytes: 66, flows: 1 }]);
  });

  it('includes dstDisplayName and dstEndpointLabel when dstDisplayNameField resolves', async () => {
    const finding: Finding = {
      id: 'egress:10.0.0.1',
      kind: 'egress_anomaly',
      severity: 'high',
      title: 't',
      summary: 's',
      evidence: { contributingSrcIps: ['10.0.0.1'] },
      window: { from: '2020-01-01T00:00:00.000Z', to: '2020-01-01T00:15:00.000Z' },
    };
    const fieldsWithDst: FieldPreference = {
      ...fields,
      dstDisplayNameField: 'destination.k8s.pod.name',
    };
    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: {
              buckets: [
                {
                  key: '8.8.8.8',
                  doc_count: 2,
                  dst_bytes: { value: 99 },
                  top_dst_display: { buckets: [{ key: 'api-svc', doc_count: 1, dnm: { value: 99 } }] },
                },
              ],
            },
            by_dport: { buckets: [] },
            by_client_ns: { buckets: [] },
            by_client_pod: { buckets: [] },
          },
        },
      }),
    } as unknown as SearchClient;

    const out = await enrichEgressFinding({ client, index: 'ix', fields: fieldsWithDst, finding });
    expect(out.evidence['topDestinations']).toEqual([
      {
        dstIp: '8.8.8.8',
        dstDisplayName: 'api-svc',
        dstEndpointLabel: 'api-svc (8.8.8.8)',
        bytes: 99,
        flows: 2,
      },
    ]);
  });

  it('includes protocol on topDstPorts when protoField resolves', async () => {
    const finding: Finding = {
      id: 'egress:10.0.0.1',
      kind: 'egress_anomaly',
      severity: 'high',
      title: 't',
      summary: 's',
      evidence: { contributingSrcIps: ['10.0.0.1'] },
      window: { from: '2020-01-01T00:00:00.000Z', to: '2020-01-01T00:15:00.000Z' },
    };
    const fieldsWithProto: FieldPreference = { ...fields, protoField: 'l4.proto.name' };
    const client = {
      search: vi.fn().mockResolvedValue({
        body: {
          aggregations: {
            by_dst: { buckets: [] },
            by_dport: {
              buckets: [
                {
                  key: 443,
                  doc_count: 2,
                  pbytes: { value: 100 },
                  top_proto: { buckets: [{ key: 'tcp', doc_count: 2, pproto: { value: 100 } }] },
                },
              ],
            },
          },
        },
      }),
    } as unknown as SearchClient;

    const out = await enrichEgressFinding({ client, index: 'ix', fields: fieldsWithProto, finding });
    expect(out.evidence['topDstPorts']).toEqual([{ port: 443, bytes: 100, flows: 2, protocol: 'tcp' }]);
  });
});

describe('enrichInsightsEgressBatch', () => {
  it('logs and preserves finding when search fails', async () => {
    const finding: Finding = {
      id: 'egress:10.0.0.1',
      kind: 'egress_anomaly',
      severity: 'high',
      title: 't',
      summary: 's',
      evidence: { contributingSrcIps: ['10.0.0.1'] },
      window: { from: '2020-01-01T00:00:00.000Z', to: '2020-01-01T00:15:00.000Z' },
    };
    const client = { search: vi.fn().mockRejectedValue(new Error('search failed')) } as unknown as SearchClient;
    const log = { warn: vi.fn() };
    const out = await enrichInsightsEgressBatch({
      client,
      index: 'ix',
      fields,
      findings: [finding],
      log: log as never,
    });
    expect(out[0]).toBe(finding);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ findingId: 'egress:10.0.0.1' }),
      'egress insight enrichment failed',
    );
  });
});
