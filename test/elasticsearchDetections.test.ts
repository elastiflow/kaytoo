import { describe, expect, it, vi } from 'vitest';
import { fetchElasticsearchMlAnomalyFindings } from '../src/insights/elasticsearchDetections.js';

describe('fetchElasticsearchMlAnomalyFindings', () => {
  it('returns healthyEmpty false when jobIds empty', async () => {
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: {} as never,
      jobIds: [],
      now: new Date(),
      minutesBack: 10,
    });
    expect(r.findings).toEqual([]);
    expect(r.healthyEmpty).toBe(false);
  });

  it('maps ML records to findings', async () => {
    const ml = {
      getRecords: vi.fn().mockResolvedValue({
        records: [
          {
            record_score: 95,
            initial_record_score: 0,
            over_field_value: '10.0.0.1',
            timestamp: 1_700_000_000_000,
          },
        ],
      }),
    };
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: { ml } as never,
      jobIds: ['job-a'],
      now: new Date('2024-01-15T12:00:00Z'),
      minutesBack: 60,
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.kind).toBe('elasticsearch_ml_anomaly');
    expect(r.findings[0]!.severity).toBe('high');
    expect(r.findings[0]!.evidence['contributingSrcIps']).toEqual(['10.0.0.1']);
  });

  it('returns ok false when getRecords throws', async () => {
    const ml = { getRecords: vi.fn().mockRejectedValue(new Error('ml down')) };
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: { ml } as never,
      jobIds: ['j'],
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/failed/i);
  });

  it('maps medium and low severity from score', async () => {
    const ml = {
      getRecords: vi.fn().mockResolvedValue({
        records: [
          { record_score: 60, over_field_value: '10.0.0.2', timestamp: '2024-01-01T00:00:00Z' },
          { record_score: 10, over_field_value: '10.0.0.3', timestamp: '2024-01-01T00:00:00Z' },
        ],
      }),
    };
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: { ml } as never,
      jobIds: ['j'],
      now: new Date('2024-01-15T12:00:00Z'),
      minutesBack: 60,
    });
    expect(r.findings.map((f) => f.severity)).toEqual(['medium', 'low']);
  });

  it('uses initial_record_score when record_score is zero', async () => {
    const ml = {
      getRecords: vi.fn().mockResolvedValue({
        records: [{ record_score: 0, initial_record_score: 88, over_field_value: '', timestamp: '' }],
      }),
    };
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: { ml } as never,
      jobIds: ['j'],
      now: new Date('2024-01-15T12:00:00Z'),
      minutesBack: 10,
    });
    expect(r.findings[0]!.severity).toBe('medium');
    expect(r.findings[0]!.title).toMatch(/^ML anomaly \(score/);
    expect(r.findings[0]!.window.from).toMatch(/^1970/);
  });

  it('skips non-object records and zero scores', async () => {
    const ml = {
      getRecords: vi.fn().mockResolvedValue({
        records: [null, { record_score: 0, initial_record_score: 0 }, { record_score: 5, over_field_value: '1.1.1.1' }],
      }),
    };
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: { ml } as never,
      jobIds: ['j'],
      now: new Date('2024-01-15T12:00:00Z'),
      minutesBack: 10,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.healthyEmpty).toBe(false);
  });

  it('treats missing records array as empty', async () => {
    const ml = { getRecords: vi.fn().mockResolvedValue({}) };
    const r = await fetchElasticsearchMlAnomalyFindings({
      client: { ml } as never,
      jobIds: ['j'],
      now: new Date(),
      minutesBack: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.healthyEmpty).toBe(true);
  });
});
