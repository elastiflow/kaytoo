import { describe, expect, it, vi } from 'vitest';
import { mlJobMatchesEgressShape, ensureElasticsearchMlAnomalyPipeline } from '../src/elasticsearch/mlAnomalyLifecycle.js';

describe('mlJobMatchesEgressShape', () => {
  const job = {
    job_id: 'j1',
    data_description: { time_field: '@timestamp' },
    analysis_config: {
      detectors: [{ function: 'sum', field_name: 'flow.bytes', over_field_name: 'flow.client.ip.addr' }],
    },
    datafeed_config: { indices: ['flow-*'] },
  };

  it('matches egress population job', () => {
    expect(mlJobMatchesEgressShape(job, 'flow-*', 'flow.client.ip.addr', 'flow.bytes')).toBe(true);
  });

  it('rejects wrong detector function', () => {
    expect(
      mlJobMatchesEgressShape(
        {
          ...job,
          analysis_config: {
            detectors: [{ function: 'mean', field_name: 'flow.bytes', over_field_name: 'flow.client.ip.addr' }],
          },
        },
        'flow-*',
        'flow.client.ip.addr',
        'flow.bytes',
      ),
    ).toBe(false);
  });

  it('matches when datafeed indices array is empty', () => {
    expect(
      mlJobMatchesEgressShape(
        {
          ...job,
          datafeed_config: { indices: [] },
        },
        'flow-*',
        'flow.client.ip.addr',
        'flow.bytes',
      ),
    ).toBe(true);
  });

  it('matches index via pattern prefix overlap', () => {
    expect(
      mlJobMatchesEgressShape(
        {
          ...job,
          datafeed_config: { indices: ['flow-codex'] },
        },
        'flow-codex-*',
        'flow.client.ip.addr',
        'flow.bytes',
      ),
    ).toBe(true);
  });
});

describe('ensureElasticsearchMlAnomalyPipeline', () => {
  it('adopts existing matching job', async () => {
    const ml = {
      getJobs: vi.fn().mockResolvedValue({
        jobs: [
          {
            job_id: 'kaytoo-flow-egress-by-src',
            data_description: { time_field: '@timestamp' },
            analysis_config: {
              detectors: [{ function: 'sum', field_name: 'flow.bytes', over_field_name: 'flow.client.ip.addr' }],
            },
            datafeed_config: { indices: ['flow-*'] },
          },
        ],
      }),
      openJob: vi.fn().mockResolvedValue({}),
      getDatafeeds: vi.fn().mockResolvedValue({ datafeeds: [{ datafeed_id: 'kaytoo-flow-egress-by-src-datafeed' }] }),
      startDatafeed: vi.fn().mockResolvedValue({}),
      putJob: vi.fn(),
      putDatafeed: vi.fn(),
    };
    const client = { ml } as never;
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.elasticsearch?.jobIds).toEqual(['kaytoo-flow-egress-by-src']);
    expect(ml.putJob).not.toHaveBeenCalled();
  });

  it('returns ok when getDatafeeds fails during adopted job startup', async () => {
    const ml = {
      getJobs: vi.fn().mockResolvedValue({
        jobs: [
          {
            job_id: 'kaytoo-flow-egress-by-src',
            data_description: { time_field: '@timestamp' },
            analysis_config: {
              detectors: [{ function: 'sum', field_name: 'flow.bytes', over_field_name: 'flow.client.ip.addr' }],
            },
            datafeed_config: { indices: ['flow-*'] },
          },
        ],
      }),
      openJob: vi.fn().mockResolvedValue({}),
      getDatafeeds: vi.fn().mockRejectedValue(new Error('ml getDatafeeds unavailable')),
      startDatafeed: vi.fn(),
      putJob: vi.fn(),
      putDatafeed: vi.fn(),
    };
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client: { ml } as never,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(ml.startDatafeed).not.toHaveBeenCalled();
  });

  it('creates job and datafeed when none match', async () => {
    const ml = {
      getJobs: vi.fn().mockResolvedValue({ jobs: [] }),
      putJob: vi.fn().mockResolvedValue({}),
      putDatafeed: vi.fn().mockResolvedValue({}),
      openJob: vi.fn().mockResolvedValue({}),
      getDatafeeds: vi.fn().mockResolvedValue({ datafeeds: [{ datafeed_id: 'kaytoo-flow-egress-by-src-datafeed' }] }),
      startDatafeed: vi.fn().mockResolvedValue({}),
    };
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client: { ml } as never,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(ml.putJob).toHaveBeenCalled();
    expect(ml.putDatafeed).toHaveBeenCalled();
  });

  it('treats putJob resource_already_exists as non-fatal', async () => {
    const ml = {
      getJobs: vi.fn().mockResolvedValue({ jobs: [] }),
      putJob: vi.fn().mockRejectedValue(new Error('resource_already_exists_exception')),
      putDatafeed: vi.fn().mockResolvedValue({}),
      openJob: vi.fn().mockResolvedValue({}),
      getDatafeeds: vi.fn().mockResolvedValue({ datafeeds: [{ datafeed_id: 'kaytoo-flow-egress-by-src-datafeed' }] }),
      startDatafeed: vi.fn().mockResolvedValue({}),
    };
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client: { ml } as never,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(ml.putDatafeed).toHaveBeenCalled();
  });

  it('treats putDatafeed resource_already_exists as non-fatal', async () => {
    const ml = {
      getJobs: vi.fn().mockResolvedValue({ jobs: [] }),
      putJob: vi.fn().mockResolvedValue({}),
      putDatafeed: vi.fn().mockRejectedValue(new Error('resource_already_exists_exception')),
      openJob: vi.fn().mockResolvedValue({}),
      getDatafeeds: vi.fn().mockResolvedValue({ datafeeds: [{ datafeed_id: 'kaytoo-flow-egress-by-src-datafeed' }] }),
      startDatafeed: vi.fn().mockResolvedValue({}),
    };
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client: { ml } as never,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(ml.openJob).toHaveBeenCalled();
  });

  it('returns not ok when putDatafeed fails without resource_already_exists', async () => {
    const ml = {
      getJobs: vi.fn().mockResolvedValue({ jobs: [] }),
      putJob: vi.fn().mockResolvedValue({}),
      putDatafeed: vi.fn().mockRejectedValue(new Error('forbidden')),
      openJob: vi.fn(),
      getDatafeeds: vi.fn(),
      startDatafeed: vi.fn(),
    };
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client: { ml } as never,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
  });

  it('returns not ok when getJobs throws', async () => {
    const ml = {
      getJobs: vi.fn().mockRejectedValue(new Error('cluster block')),
    };
    const r = await ensureElasticsearchMlAnomalyPipeline({
      client: { ml } as never,
      indexPattern: 'flow-*',
      srcIpField: 'flow.client.ip.addr',
      bytesField: 'flow.bytes',
      pollIntervalSeconds: 300,
    });
    expect(r.ok).toBe(false);
  });
});
