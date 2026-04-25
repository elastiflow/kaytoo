import type { Client } from '@opensearch-project/opensearch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { egressSpikeDrilldownTool } from '../src/agent/tools/handlers/egressSpikeDrilldown.js';
import { topFanOut } from '../src/agent/tools/handlers/topFanOut.js';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import * as fieldCaps from '../src/opensearch/fieldCaps.js';
import { DEFAULT_TEST_FLOW_FIELDS } from './fixtures/flowFields.js';

const testFields = DEFAULT_TEST_FLOW_FIELDS;

describe('egressSpikeDrilldownTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns drilldown aligned with top spike sources (mocked OpenSearch)', async () => {
    let call = 0;
    const client = {
      search: vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return {
            body: {
              aggregations: {
                by_src: {
                  buckets: [{ key: '10.0.0.1', doc_count: 10, bytes: { value: 200 } }],
                },
              },
            },
          };
        }
        if (call === 2) {
          return {
            body: {
              aggregations: {
                by_src: {
                  buckets: [{ key: '10.0.0.1', doc_count: 8, bytes: { value: 100 } }],
                },
              },
            },
          };
        }
        return {
          body: {
            aggregations: {
              by_dst: {
                buckets: [
                  { key: '8.8.8.8', doc_count: 3, bytes: { value: 120 } },
                  { key: '1.1.1.1', doc_count: 2, bytes: { value: 80 } },
                ],
              },
            },
          },
        };
      }),
    } as unknown as Client;

    const out = (await egressSpikeDrilldownTool(
      {
        client,
        fields: testFields,
        policy: defaultAgentPolicy,
        defaultIndex: 'elastiflow-flow-codex-*',
        thresholds: { egressMultiplier: 2, egressMinBytes: 80, portscanDistinctDstPorts: 50, portscanMinPackets: 200 },
      },
      { spikeTopK: 2, destinationsPerSource: 5, currentMinutesBack: 15, baselineMinutesBack: 60 },
    )) as {
      drilldown: Array<{ srcIp: string; topDestinations: Array<{ dstIp: string; bytes: number }> }>;
    };

    expect(out.drilldown).toHaveLength(1);
    expect(out.drilldown[0]?.srcIp).toBe('10.0.0.1');
    expect(out.drilldown[0]?.topDestinations.map((d) => d.dstIp)).toEqual(['8.8.8.8', '1.1.1.1']);
    expect((client.search as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });
});

describe('topFanOut nested destinations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes topDestinations when includeTopDestinations is true', async () => {
    vi.spyOn(fieldCaps, 'chooseFields').mockResolvedValue(testFields);

    const client = {
      search: vi.fn(async () => ({
        body: {
          aggregations: {
            by_src: {
              buckets: [
                {
                  key: '192.168.1.10',
                  doc_count: 50,
                  distinct_dst: { value: 4 },
                  sum_bytes: { value: 900 },
                  top_dst_ips: {
                    buckets: [
                      { key: '10.0.0.5', doc_count: 20, dst_bytes: { value: 500 } },
                      { key: '10.0.0.6', doc_count: 15, dst_bytes: { value: 400 } },
                    ],
                  },
                },
              ],
            },
          },
        },
      })),
    } as unknown as Client;

    const out = (await topFanOut(
      { client, policy: defaultAgentPolicy, defaultIndex: 'elastiflow-flow-codex-*' },
      { minutesBack: 15, size: 5, includeTopDestinations: true, topDestinationsSize: 5 },
    )) as {
      sources: Array<{ srcIp: string; topDestinations?: Array<{ dstIp: string; bytes: number }> }>;
    };

    expect(out.sources[0]?.topDestinations?.map((d) => d.dstIp)).toEqual(['10.0.0.5', '10.0.0.6']);
    expect(out.sources[0]?.topDestinations?.[0]?.bytes).toBe(500);
  });

  it('adds internal destination filter when internalDstOnly is true', async () => {
    vi.spyOn(fieldCaps, 'chooseFields').mockResolvedValue(testFields);

    const search = vi.fn(async () => ({
      body: {
        aggregations: {
          by_src: {
            buckets: [
              {
                key: '192.168.1.10',
                doc_count: 10,
                distinct_dst: { value: 2 },
                sum_bytes: { value: 100 },
              },
            ],
          },
        },
      },
    }));
    const client = { search } as unknown as Client;

    await topFanOut(
      { client, policy: defaultAgentPolicy, defaultIndex: 'elastiflow-flow-codex-*' },
      { minutesBack: 30, size: 3, internalDstOnly: true },
    );

    const calls = search.mock.calls as unknown[][];
    expect(calls[0]?.length).toBeGreaterThan(0);
    const req = calls[0]![0] as { body: { query: { bool: { filter: unknown[] } } } };
    expect(req.body.query.bool.filter.length).toBeGreaterThanOrEqual(2);
  });
});
