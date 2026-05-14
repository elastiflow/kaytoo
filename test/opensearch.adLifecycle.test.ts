import { describe, expect, it, vi } from 'vitest';
import * as logging from '../src/logging/logger.js';
import { detectorMatchesEgressShape, ensureOpenSearchAnomalyPipeline } from '../src/opensearch/adLifecycle.js';

describe('detectorMatchesEgressShape', () => {
  const shaped = {
    time_field: '@timestamp',
    indices: ['flow-codex-*'],
    category_field: ['flow.client.ip.addr'],
    feature_attributes: [
      { aggregation_query: { kaytoo_sum_bytes: { sum: { field: 'flow.bytes' } } } },
    ],
  };

  it('returns true for egress-shaped detector', () => {
    expect(
      detectorMatchesEgressShape(shaped, 'flow-codex-*', 'flow.client.ip.addr', 'flow.bytes'),
    ).toBe(true);
  });

  it('returns false when time field differs', () => {
    expect(detectorMatchesEgressShape({ ...shaped, time_field: 'ts' }, 'flow-codex-*', 'flow.client.ip.addr', 'flow.bytes')).toBe(
      false,
    );
  });

  it('returns false when indices do not match pattern', () => {
    expect(
      detectorMatchesEgressShape({ ...shaped, indices: ['other-*'] }, 'flow-codex-*', 'flow.client.ip.addr', 'flow.bytes'),
    ).toBe(false);
  });

  it('returns false when category field missing', () => {
    expect(
      detectorMatchesEgressShape({ ...shaped, category_field: ['other'] }, 'flow-codex-*', 'flow.client.ip.addr', 'flow.bytes'),
    ).toBe(false);
  });

  it('returns false when category_field is neither string nor string array', () => {
    expect(
      detectorMatchesEgressShape({ ...shaped, category_field: 1 as unknown as string[] }, 'flow-codex-*', 'flow.client.ip.addr', 'flow.bytes'),
    ).toBe(false);
  });

  it('matches category_field when stored as a single string', () => {
    const det = {
      time_field: '@timestamp',
      indices: ['flow-codex-*'],
      category_field: 'flow.client.ip.addr',
      feature_attributes: shaped.feature_attributes,
    };
    expect(detectorMatchesEgressShape(det, 'flow-codex-*', 'flow.client.ip.addr', 'flow.bytes')).toBe(true);
  });

  it('matches index when pattern contains detector index without wildcard', () => {
    const det = {
      ...shaped,
      indices: ['elastiflow-flow-codex'],
    };
    expect(detectorMatchesEgressShape(det, 'elastiflow-flow-codex-*', 'flow.client.ip.addr', 'flow.bytes')).toBe(true);
  });

  it('returns false when sum bytes feature missing', () => {
    expect(
      detectorMatchesEgressShape(
        {
          ...shaped,
          feature_attributes: [{ aggregation_query: { x: { avg: { field: 'flow.bytes' } } } }],
        },
        'flow-codex-*',
        'flow.client.ip.addr',
        'flow.bytes',
      ),
    ).toBe(false);
  });
});

describe('ensureOpenSearchAnomalyPipeline', () => {
  function clientWithTransport(transport: ReturnType<typeof vi.fn>) {
    return { transport: { request: transport } } as never;
  }

  it('returns not ok on plugin 404', async () => {
    const transport = vi.fn().mockResolvedValue({ statusCode: 404, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.hasScopedSources).toBe(false);
  });

  it('adopts first matching detector and starts it', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          hits: {
            hits: [
              {
                _id: 'det1',
                _source: {
                  name: 'Kaytoo flow egress by source',
                  time_field: '@timestamp',
                  indices: ['flow-*'],
                  category_field: ['flow.client.ip.addr'],
                  feature_attributes: [
                    { aggregation_query: { k: { sum: { field: 'flow.bytes' } } } },
                  ],
                },
              },
            ],
          },
        },
      })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.hasScopedSources).toBe(true);
    expect(r.opensearch?.detectorIds).toEqual(['det1']);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: expect.stringContaining('detectors') }),
    );
  });

  it('returns warning when AD search returns 500', async () => {
    const transport = vi.fn().mockResolvedValue({ statusCode: 500, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
  });

  it('returns not ok when transport throws', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('network'));
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/threw/i);
  });

  it('parses detectorList array from search response', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          detectorList: [
            {
              id: 'dl1',
              time_field: '@timestamp',
              indices: ['flow-*'],
              category_field: ['flow.client.ip.addr'],
              feature_attributes: [{ aggregation_query: { k: { sum: { field: 'flow.bytes' } } } }],
            },
          ],
        },
      })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.opensearch?.detectorIds).toEqual(['dl1']);
  });

  it('re-lists when create omits _id', async () => {
    const shaped = {
      time_field: '@timestamp',
      indices: ['flow-*'],
      category_field: ['flow.client.ip.addr'],
      feature_attributes: [{ aggregation_query: { k: { sum: { field: 'flow.bytes' } } } }],
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, body: { hits: { hits: [] } } })
      .mockResolvedValueOnce({ statusCode: 201, body: {} })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { hits: { hits: [{ _id: 'rel1', _source: { name: 'Kaytoo flow egress by source', ...shaped } }] } },
      })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.opensearch?.detectorIds).toEqual(['rel1']);
  });

  it('tolerates start returning 400', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          hits: {
            hits: [
              {
                _id: 'det1',
                _source: {
                  time_field: '@timestamp',
                  indices: ['flow-*'],
                  category_field: ['flow.client.ip.addr'],
                  feature_attributes: [{ aggregation_query: { k: { sum: { field: 'flow.bytes' } } } }],
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ statusCode: 400, body: {} })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
  });

  it('returns not ok when create fails with 400', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { hits: { hits: [] } },
      })
      .mockResolvedValueOnce({ statusCode: 400, body: { error: 'bad' } });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.hasScopedSources).toBe(false);
  });

  it('creates detector when none match', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { hits: { hits: [] } },
      })
      .mockResolvedValueOnce({ statusCode: 201, body: { _id: 'newdet' } })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.opensearch?.detectorIds).toEqual(['newdet']);
  });

  it('prefers Kaytoo-named detector when multiple match', async () => {
    const shaped = {
      time_field: '@timestamp',
      indices: ['flow-*'],
      category_field: ['flow.client.ip.addr'],
      feature_attributes: [{ aggregation_query: { k: { sum: { field: 'flow.bytes' } } } }],
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          hits: {
            hits: [
              { _id: 'other', _source: { name: 'other-det', ...shaped } },
              { _id: 'kay', _source: { name: 'Kaytoo flow egress by source', ...shaped } },
            ],
          },
        },
      })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.opensearch?.detectorIds).toEqual(['kay']);
  });

  it('logs debug when multiple AD detectors match egress shape', async () => {
    const debug = vi.fn();
    vi.spyOn(logging, 'getLogger').mockReturnValue({
      debug,
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    } as never);
    const shaped = {
      time_field: '@timestamp',
      indices: ['flow-*'],
      category_field: ['flow.client.ip.addr'],
      feature_attributes: [{ aggregation_query: { k: { sum: { field: 'flow.bytes' } } } }],
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          hits: {
            hits: [
              { _id: 'z-det', _source: { name: 'z', ...shaped } },
              { _id: 'a-det', _source: { name: 'a', ...shaped } },
            ],
          },
        },
      })
      .mockResolvedValue({ statusCode: 200, body: {} });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.opensearch?.detectorIds).toEqual(['a-det']);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ chosenDetectorId: 'a-det', otherMatchingDetectorIds: ['z-det'] }),
      expect.stringMatching(/tie-break/i),
    );
    vi.restoreAllMocks();
  });

  it('returns not ok when create omits id and relist finds no detector', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, body: { hits: { hits: [] } } })
      .mockResolvedValueOnce({ statusCode: 201, body: {} })
      .mockResolvedValueOnce({ statusCode: 200, body: { hits: { hits: [] } } });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/no detector id/i);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('returns not ok when create omits id and relist has no egress-shaped detectors', async () => {
    const shapedWrongIndex = {
      name: 'Kaytoo flow egress by source',
      time_field: '@timestamp',
      indices: ['other-index-*'],
      category_field: ['flow.client.ip.addr'],
      feature_attributes: [{ aggregation_query: { k: { sum: { field: 'flow.bytes' } } } }],
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, body: { hits: { hits: [] } } })
      .mockResolvedValueOnce({ statusCode: 201, body: {} })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { hits: { hits: [{ _id: 'rel-orphan', _source: shapedWrongIndex }] } },
      });
    const r = await ensureOpenSearchAnomalyPipeline({
      client: clientWithTransport(transport),
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/no detector id/i);
  });
});
