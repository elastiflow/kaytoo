import { describe, expect, it, vi } from 'vitest';
import {
  fetchOpenSearchAdFindings,
  fetchOpenSearchAlertingFindings,
} from '../src/insights/opensearchDetections.js';

function clientWithSearch(search: ReturnType<typeof vi.fn>) {
  return { search, fieldCaps: vi.fn() };
}

describe('fetchOpenSearchAlertingFindings', () => {
  it('returns findings when first index has hits', async () => {
    const search = vi.fn().mockResolvedValue({
      body: {
        _shards: { total: 1 },
        hits: {
          hits: [
            {
              _id: 'h1',
              _index: '.opensearch-alerting-alerts-000001',
              _source: { monitor_name: 'm1', trigger_name: 't1', state: 'ACTIVE' },
            },
          ],
        },
      },
    });
    const r = await fetchOpenSearchAlertingFindings({
      client: clientWithSearch(search) as never,
      now: new Date(),
      minutesBack: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.kind).toBe('opensearch_alert');
    expect(r.findings[0]!.title).toContain('m1');
    expect(r.findings[0]!.summary).toContain('ACTIVE');
  });

  it('falls back to next index when shards total is zero', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ body: { _shards: { total: 0 }, hits: { hits: [] } } })
      .mockResolvedValueOnce({
        body: {
          _shards: { total: 1 },
          hits: {
            hits: [
              {
                _id: 99,
                _index: 'ix',
                _source: { monitor_id: 'mid', trigger_name: 'tr' },
              },
            ],
          },
        },
      });
    const r = await fetchOpenSearchAlertingFindings({
      client: clientWithSearch(search) as never,
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.findings[0]!.id).toContain('os-alert:');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('returns healthyEmpty when indices respond with zero hits', async () => {
    const search = vi.fn().mockResolvedValue({
      body: { _shards: { total: 1 }, hits: { hits: [] } },
    });
    const r = await fetchOpenSearchAlertingFindings({
      client: clientWithSearch(search) as never,
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.healthyEmpty).toBe(true);
  });

  it('returns warning when no index could be queried successfully', async () => {
    const search = vi.fn().mockRejectedValue(new Error('network'));
    const r = await fetchOpenSearchAlertingFindings({
      client: clientWithSearch(search) as never,
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.warning).toMatch(/not reachable/i);
  });

  it('parses string JSON search body for alerting', async () => {
    const payload = {
      _shards: { total: 1 },
      hits: {
        hits: [{ _id: 's1', _index: 'ix', _source: { monitor_name: 'mon', trigger_name: 'tr' } }],
      },
    };
    const search = vi.fn().mockResolvedValue({ body: JSON.stringify(payload) });
    const r = await fetchOpenSearchAlertingFindings({
      client: clientWithSearch(search) as never,
      now: new Date(),
      minutesBack: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(1);
  });

  it('skips malformed string body and continues scan', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ body: 'not-json{' })
      .mockResolvedValueOnce({
        body: {
          _shards: { total: 1 },
          hits: { hits: [{ _id: 'ok', _source: { monitor_id: 'm', trigger_name: 't' } }] },
        },
      });
    const r = await fetchOpenSearchAlertingFindings({
      client: clientWithSearch(search) as never,
      now: new Date(),
      minutesBack: 1,
    });
    expect(r.ok).toBe(true);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('fetchOpenSearchAdFindings', () => {
  it('returns healthyEmpty false when detectorIds is empty array (scoped mode)', async () => {
    const search = vi.fn();
    const r = await fetchOpenSearchAdFindings({
      client: clientWithSearch(search) as never,
      minutesBack: 10,
      detectorIds: [],
    });
    expect(r.findings).toEqual([]);
    expect(r.healthyEmpty).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('maps anomaly grade to severity tiers', async () => {
    const hits = [
      { _id: 'g1', _index: 'ad', _source: { anomaly_grade: 0.95, confidence: 0.9 } },
      { _id: 'g2', _index: 'ad', _source: { anomaly_grade: 0.75, confidence: 0.5 } },
      { _id: 'g3', _index: 'ad', _source: { anomaly_grade: 0.5, confidence: 0.2 } },
    ];
    const search = vi.fn().mockResolvedValue({
      body: { _shards: { total: 1 }, hits: { hits } },
    });
    const r = await fetchOpenSearchAdFindings({
      client: clientWithSearch(search) as never,
      minutesBack: 10,
    });
    expect(r.findings.map((f) => f.severity)).toEqual(['high', 'medium', 'low']);
  });

  it('scans next AD index after errors', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({
        body: { _shards: { total: 1 }, hits: { hits: [{ _id: 'x', _source: { anomaly_grade: 1, confidence: 1 } }] } },
      });
    const r = await fetchOpenSearchAdFindings({
      client: clientWithSearch(search) as never,
      minutesBack: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(1);
  });

  it('falls through AD patterns when first has zero shards', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ body: { _shards: { total: 0 }, hits: { hits: [] } } })
      .mockResolvedValueOnce({
        body: {
          _shards: { total: 1 },
          hits: {
            hits: [{ _id: 'z', _index: 'ad2', _source: { anomaly_grade: 0.8, confidence: 0.5, detector_name: 'd1' } }],
          },
        },
      });
    const r = await fetchOpenSearchAdFindings({ client: clientWithSearch(search) as never, minutesBack: 10 });
    expect(r.ok).toBe(true);
    expect(search).toHaveBeenCalledTimes(2);
    expect(r.findings[0]!.title).toContain('d1');
  });

  it('parses string JSON body for AD hits', async () => {
    const inner = {
      _shards: { total: 1 },
      hits: { hits: [{ _id: 'str', _source: { anomaly_grade: 0.85, confidence: 0.6, name: 'n1' } }] },
    };
    const search = vi.fn().mockResolvedValue({ body: JSON.stringify(inner) });
    const r = await fetchOpenSearchAdFindings({ client: clientWithSearch(search) as never, minutesBack: 10 });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.title).toContain('n1');
  });

  it('includes detector_id terms filter when detectorIds provided', async () => {
    const search = vi.fn().mockResolvedValue({
      body: { _shards: { total: 1 }, hits: { hits: [] } },
    });
    await fetchOpenSearchAdFindings({
      client: clientWithSearch(search) as never,
      minutesBack: 7,
      detectorIds: ['det-a', 'det-b'],
    });
    const call = search.mock.calls[0]![0] as { body: { query: { bool: { filter: unknown[] } } } };
    expect(call.body.query.bool.filter[0]).toEqual({ terms: { detector_id: ['det-a', 'det-b'] } });
  });

  it('truncates entity list in AD title when more than two', async () => {
    const search = vi.fn().mockResolvedValue({
      body: {
        _shards: { total: 1 },
        hits: {
          hits: [
            {
              _id: 'e1',
              _source: {
                anomaly_grade: 0.8,
                confidence: 0.5,
                detector_name: 'det',
                entity: [{ value: '10.0.0.1' }, { value: '10.0.0.2' }, { value: '10.0.0.3' }],
              },
            },
          ],
        },
      },
    });
    const r = await fetchOpenSearchAdFindings({ client: clientWithSearch(search) as never, minutesBack: 10 });
    expect(r.findings[0]!.title).toMatch(/…/);
    expect((r.findings[0]!.evidence as { contributingSrcIps?: string[] }).contributingSrcIps).toEqual([
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.3',
    ]);
  });

  it('uses data_start_time and data_end_time for AD window when execution times absent', async () => {
    const search = vi.fn().mockResolvedValue({
      body: {
        _shards: { total: 1 },
        hits: {
          hits: [
            {
              _id: 'w1',
              _source: {
                anomaly_grade: 0.5,
                confidence: 0.2,
                data_start_time: '2020-01-01T00:00:00Z',
                data_end_time: '2020-01-02T00:00:00Z',
              },
            },
          ],
        },
      },
    });
    const r = await fetchOpenSearchAdFindings({ client: clientWithSearch(search) as never, minutesBack: 10 });
    expect(r.findings[0]!.window).toEqual({
      from: '2020-01-01T00:00:00Z',
      to: '2020-01-02T00:00:00Z',
    });
  });
});
