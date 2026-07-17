import { describe, expect, it, vi } from 'vitest';
import {
  fetchNativeAlertFindings,
  fetchNativeAnomalyFindings,
} from '../src/insights/nativeDetections.js';

describe('fetchNativeAlertFindings', () => {
  it('returns empty for elasticsearch backend', async () => {
    const r = await fetchNativeAlertFindings({
      backend: 'elasticsearch',
      client: {} as never,
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.findings).toEqual([]);
    expect(r.healthyEmpty).toBe(false);
  });

  it('delegates to OpenSearch alerting search', async () => {
    const search = vi.fn().mockResolvedValue({
      body: { _shards: { total: 0 }, hits: { hits: [] } },
    });
    await fetchNativeAlertFindings({
      backend: 'opensearch',
      client: { search, fieldCaps: vi.fn() } as never,
      now: new Date(),
      minutesBack: 5,
    });
    expect(search).toHaveBeenCalled();
  });
});

describe('fetchNativeAnomalyFindings', () => {
  it('returns empty for elasticsearch without ML client', async () => {
    const r = await fetchNativeAnomalyFindings({
      backend: 'elasticsearch',
      searchClient: {} as never,
      esMlClient: null,
      pipeline: { ok: true, hasScopedSources: true, elasticsearch: { jobIds: ['j'] } },
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.findings).toEqual([]);
    expect(r.healthyEmpty).toBe(false);
  });

  it('delegates OpenSearch to AD search with detector filter', async () => {
    const search = vi.fn().mockResolvedValue({
      body: {
        _shards: { total: 1 },
        hits: {
          hits: [
            {
              _id: 'h1',
              _index: 'ad',
              _source: { anomaly_grade: 0.8, confidence: 0.5, detector_id: 'd1' },
            },
          ],
        },
      },
    });
    const r = await fetchNativeAnomalyFindings({
      backend: 'opensearch',
      searchClient: { search, fieldCaps: vi.fn() } as never,
      esMlClient: null,
      pipeline: { ok: true, hasScopedSources: true, opensearch: { detectorIds: ['d1'] } },
      now: new Date(),
      minutesBack: 10,
    });
    expect(search).toHaveBeenCalled();
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.kind).toBe('opensearch_anomaly');
  });

  it('delegates Elasticsearch to ML getRecords', async () => {
    const ml = {
      getRecords: vi.fn().mockResolvedValue({
        records: [{ record_score: 60, initial_record_score: 0, over_field_value: '1.1.1.1', timestamp: 1 }],
      }),
    };
    const r = await fetchNativeAnomalyFindings({
      backend: 'elasticsearch',
      searchClient: {} as never,
      esMlClient: { ml } as never,
      pipeline: { ok: true, hasScopedSources: true, elasticsearch: { jobIds: ['job1'] } },
      now: new Date('2024-06-01T12:00:00Z'),
      minutesBack: 30,
    });
    expect(ml.getRecords).toHaveBeenCalled();
    expect(r.findings.length).toBeGreaterThan(0);
  });
});
