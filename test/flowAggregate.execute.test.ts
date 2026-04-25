import { describe, expect, it, vi } from 'vitest';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import { executeFlowAggregate, validateFlowAggregateAggs } from '../src/agent/flowAggregate.js';
import { DEFAULT_TEST_FLOW_FIELDS } from './fixtures/flowFields.js';

const fields = DEFAULT_TEST_FLOW_FIELDS;

describe('validateFlowAggregateAggs', () => {
  it('accepts a simple terms+sum tree', () => {
    const v = validateFlowAggregateAggs(
      {
        by_src: {
          terms: { field: 'flow.client.ip.addr', size: 5 },
          aggs: { bytes: { sum: { field: 'flow.bytes' } } },
        },
      },
      defaultAgentPolicy,
      fields,
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.nodeCount).toBe(2);
      expect(v.aggs.by_src).toBeDefined();
    }
  });

  it('rejects invalid agg branch nodes', () => {
    const nullBranch = validateFlowAggregateAggs({ x: null } as Record<string, unknown>, defaultAgentPolicy, fields);
    expect(nullBranch.ok).toBe(false);
  });

  it('rejects disallowed fields and script-like payloads', () => {
    const badField = validateFlowAggregateAggs(
      { x: { terms: { field: 'unknown.field', size: 3 } } },
      defaultAgentPolicy,
      fields,
    );
    expect(badField.ok).toBe(false);

    const multiType = validateFlowAggregateAggs(
      { x: { terms: { field: 'flow.bytes', size: 2 }, sum: { field: 'flow.bytes' } } },
      defaultAgentPolicy,
      fields,
    );
    expect(multiType.ok).toBe(false);
  });
});

describe('executeFlowAggregate', () => {
  it('searches allowed index and returns trimmed body for LLM', async () => {
    const body = { aggregations: { x: 1 } };
    const search = vi.fn().mockResolvedValue({ body });
    const client = { search } as never;
    const out = await executeFlowAggregate({
      client,
      index: '',
      defaultIndex: 'elastiflow-flow-codex-test',
      minutesBack: 15,
      aggs: { by_src: { terms: { field: 'flow.client.ip.addr', size: 3 }, aggs: { b: { sum: { field: 'flow.bytes' } } } } },
      policy: defaultAgentPolicy,
    });
    expect(out).toEqual(body);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'elastiflow-flow-codex-test',
        size: 0,
        body: expect.objectContaining({
          aggs: expect.any(Object),
          query: expect.any(Object),
        }),
      }),
    );
  });

  it('truncates very large aggregation responses', async () => {
    const huge = { nested: 'x'.repeat(120_000) };
    const search = vi.fn().mockResolvedValue({ body: huge });
    const out = await executeFlowAggregate({
      client: { search } as never,
      index: 'elastiflow-flow-codex-x',
      defaultIndex: 'elastiflow-flow-codex-x',
      minutesBack: 1,
      aggs: { a: { terms: { field: 'flow.client.ip.addr', size: 1 } } },
      policy: defaultAgentPolicy,
    });
    expect(out).toEqual(
      expect.objectContaining({
        truncated: true,
        preview: expect.stringContaining('"nested"'),
        omittedChars: expect.any(Number),
      }),
    );
  });

  it('rejects disallowed index', async () => {
    await expect(
      executeFlowAggregate({
        client: { search: vi.fn() } as never,
        index: 'secrets-*',
        defaultIndex: 'secrets-*',
        minutesBack: 1,
        aggs: { a: { terms: { field: 'flow.client.ip.addr', size: 1 } } },
        policy: defaultAgentPolicy,
      }),
    ).rejects.toThrow(/not allowed/i);
  });
});

describe('validateFlowAggregateAggs extended', () => {
  it('accepts terms order, shard_size override, cardinality, and date_histogram', () => {
    const v = validateFlowAggregateAggs(
      {
        root: {
          terms: {
            field: 'flow.client.ip.addr',
            size: 5,
            shard_size: 200,
            order: { _count: 'desc' },
          },
          aggs: {
            uniq: { cardinality: { field: 'flow.server.ip.addr', precision_threshold: 5000 } },
            when: {
              date_histogram: { field: '@timestamp', calendar_interval: '1h' },
            },
          },
        },
      },
      defaultAgentPolicy,
      fields,
    );
    expect(v.ok).toBe(true);
  });

  it('rejects invalid date_histogram calendar_interval', () => {
    const v = validateFlowAggregateAggs(
      {
        h: { date_histogram: { field: '@timestamp', calendar_interval: '2h' } },
      },
      defaultAgentPolicy,
      fields,
    );
    expect(v.ok).toBe(false);
  });

  it('rejects date_histogram on non-timestamp field', () => {
    const v = validateFlowAggregateAggs(
      {
        h: { date_histogram: { field: 'flow.bytes', calendar_interval: '1m' } },
      },
      defaultAgentPolicy,
      fields,
    );
    expect(v.ok).toBe(false);
  });
});
