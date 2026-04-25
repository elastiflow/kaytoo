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

});

describe('fetchOpenSearchAdFindings', () => {
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
});
