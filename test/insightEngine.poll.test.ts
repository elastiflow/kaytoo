import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger as PinoLogger } from 'pino';
import { getConfig } from '../src/config.js';
import type { Finding } from '../src/detectors/types.js';
import { findingSeverityRank } from '../src/insights/pollUtils.js';
import * as logger from '../src/logging/logger.js';

const eng = vi.hoisted(() => ({
  fetchAlerting: vi.fn(),
  fetchAd: vi.fn(),
  queryTopEgressBySource: vi.fn(),
  queryPortscanCandidates: vi.fn(),
  summarizeFindings: vi.fn(),
}));

type MockDetectionFetch = {
  ok: boolean;
  findings: Finding[];
  healthyEmpty?: boolean;
  warning?: string;
};

const llmTestEnv = {
  LLM_BASE_URL: 'https://llm.test',
  LLM_API_KEY: 'k',
} as const;

function egressWindowSpanMinutes(window: { from: string; to: string }): number {
  return (new Date(window.to).getTime() - new Date(window.from).getTime()) / 60_000;
}

function egressMockHighSpike(opts: { window: { from: string; to: string } }) {
  const spanMin = egressWindowSpanMinutes(opts.window);
  if (spanMin >= 1200) return [{ srcIp: '10.0.0.9', bytes: 1_000 }];
  if (spanMin >= 55 && spanMin <= 65) return [{ srcIp: '10.0.0.9', bytes: 120_000_000 }];
  if (spanMin >= 12 && spanMin <= 18) return [{ srcIp: '10.0.0.9', bytes: 120_000_000 }];
  return [];
}

function egressMockLowOnly(opts: { window: { from: string; to: string } }) {
  const spanMin = egressWindowSpanMinutes(opts.window);
  if (spanMin >= 1200) return [{ srcIp: '10.0.0.9', bytes: 1_000 }];
  if (spanMin >= 55 && spanMin <= 65) return [{ srcIp: '10.0.0.9', bytes: 80_000_000 }];
  if (spanMin >= 12 && spanMin <= 18) return [{ srcIp: '10.0.0.9', bytes: 80_000_000 }];
  return [];
}

function mockInsightSink() {
  return { postInsight: vi.fn().mockResolvedValue(undefined) };
}

function makeInsightsLoggerStub() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

function installInsightsLoggerSpy(stub: ReturnType<typeof makeInsightsLoggerStub>) {
  const realGetLogger = logger.getLogger.bind(logger);
  const spy = vi.spyOn(logger, 'getLogger').mockImplementation((bindings) => {
    if (bindings.component === 'insights') return stub as unknown as PinoLogger;
    return realGetLogger(bindings);
  });
  return () => spy.mockRestore();
}

function resetEngMocks(opts?: { alerting?: MockDetectionFetch; ad?: MockDetectionFetch }) {
  eng.fetchAlerting.mockReset();
  eng.fetchAd.mockReset();
  eng.queryTopEgressBySource.mockReset();
  eng.queryPortscanCandidates.mockReset();
  eng.summarizeFindings.mockReset();

  eng.fetchAlerting.mockResolvedValue(
    opts?.alerting ?? { ok: true, findings: [], healthyEmpty: true },
  );
  eng.fetchAd.mockResolvedValue(opts?.ad ?? { ok: true, findings: [], healthyEmpty: true });
  eng.queryTopEgressBySource.mockResolvedValue([]);
  eng.queryPortscanCandidates.mockResolvedValue([]);
  eng.summarizeFindings.mockResolvedValue({ post: true, text: 'summary text' });
}

vi.mock('../src/insights/opensearchDetections.js', () => ({
  fetchOpenSearchAlertingFindings: (...a: unknown[]) => eng.fetchAlerting(...a) as Promise<unknown>,
  fetchOpenSearchAdFindings: (...a: unknown[]) => eng.fetchAd(...a) as Promise<unknown>,
}));

vi.mock('../src/opensearch/queries/index.js', () => ({
  queryTopEgressBySource: (...a: unknown[]) => eng.queryTopEgressBySource(...a) as Promise<unknown>,
  queryPortscanCandidates: (...a: unknown[]) => eng.queryPortscanCandidates(...a) as Promise<unknown>,
}));

vi.mock('../src/search/client.js', () => ({
  createSearchClient: vi.fn(() => ({
    search: vi.fn().mockResolvedValue({
      body: {
        aggregations: {
          by_dst: { buckets: [] },
          by_dport: { buckets: [] },
        },
      },
    }),
    fieldCaps: vi.fn(),
  })),
}));

vi.mock('../src/opensearch/waitForFieldMapping.js', () => ({
  waitForOpenSearchFieldMapping: vi.fn(async () => ({
    bytesField: 'flow.bytes',
    srcIpField: 'flow.client.ip.addr',
    dstIpField: 'flow.server.ip.addr',
    srcPortField: 'flow.client.port',
    dstPortField: 'flow.server.port',
  })),
}));

vi.mock('../src/llm/openaiCompat.js', () => ({
  createOpenAiCompatClient: vi.fn(() => ({
    summarizeFindings: (input: { findings: unknown[] }) => eng.summarizeFindings(input),
    chatCompletions: vi.fn(),
  })),
}));

function consoleSearchConfig() {
  return getConfig({
    ...llmTestEnv,
    OPENSEARCH_URL: 'https://os.test',
    OPENSEARCH_USERNAME: 'u',
    OPENSEARCH_PASSWORD: 'p',
  });
}

function elasticConsoleConfig() {
  return getConfig({
    ...llmTestEnv,
    ELASTICSEARCH_URL: 'https://es.test',
    ELASTICSEARCH_USERNAME: 'u',
    ELASTICSEARCH_PASSWORD: 'p',
  });
}

function slackChatSearchConfig() {
  return getConfig(
    {
      ...llmTestEnv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_TOKEN: 'xapp-test',
      SLACK_CHANNEL_ID: 'C999',
      OPENSEARCH_URL: 'https://os.test',
      OPENSEARCH_USERNAME: 'u',
      OPENSEARCH_PASSWORD: 'p',
    },
    { outputOverride: 'chat' },
  );
}

const sampleFinding: Finding = {
  id: 'os-alert:test-1',
  kind: 'opensearch_alert',
  severity: 'high',
  title: 'Alert',
  summary: 'S',
  evidence: {},
  window: { from: 'a', to: 'b' },
};

describe('startInsightEngine', () => {
  beforeEach(() => {
    resetEngMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips heuristics when OpenSearch alerting and AD are healthy empty', async () => {
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    const { stop } = await startInsightEngine({
      config: consoleSearchConfig(),
      insightSink,
    });
    expect(insightSink.postInsight).not.toHaveBeenCalled();
    stop();
  });

  it('posts backend findings and uses LLM summary', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [sampleFinding], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });

    expect(eng.summarizeFindings).toHaveBeenCalled();
    expect(insightSink.postInsight).toHaveBeenCalledWith('summary text');
  });

  it('skips proactive post when summarization fails (fail-closed)', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [sampleFinding], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    eng.summarizeFindings.mockRejectedValue(new Error('llm unavailable'));

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });

    expect(insightSink.postInsight).not.toHaveBeenCalled();
  });

  it('runs heuristics for Elasticsearch backend without rare-destination query', async () => {
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: elasticConsoleConfig(), insightSink });

    expect(eng.queryTopEgressBySource).toHaveBeenCalled();
    expect(
      eng.queryTopEgressBySource.mock.calls.every(
        (c) => (c[0] as { externalOnly?: boolean }).externalOnly === true,
      ),
    ).toBe(true);
    expect(insightSink.postInsight).not.toHaveBeenCalled();
  });

  it('dedupes repeated findings across polls', async () => {
    vi.useFakeTimers();
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [sampleFinding], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });

    const base = consoleSearchConfig();
    const config = { ...base, behavior: { ...base.behavior, pollIntervalSeconds: 1 } };

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    const { stop } = await startInsightEngine({ config, insightSink });

    expect(insightSink.postInsight).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    await vi.runOnlyPendingTimersAsync();

    expect(insightSink.postInsight).toHaveBeenCalledTimes(1);
    stop();
  });

  it('logs degraded warnings when OpenSearch detection fetches fail', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: false, findings: [], warning: 'alerting down' });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });

    expect(eng.queryTopEgressBySource).toHaveBeenCalled();
  });

  it('posts heuristic egress findings when flow queries show a spike', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.queryTopEgressBySource.mockImplementation((opts: { window: { from: string; to: string } }) =>
      Promise.resolve(egressMockHighSpike(opts)),
    );
    eng.queryPortscanCandidates.mockResolvedValue([]);

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });

    expect(eng.summarizeFindings).toHaveBeenCalled();
    expect(insightSink.postInsight).toHaveBeenCalled();
    const summarized = eng.summarizeFindings.mock.calls[0]![0] as { findings: { id: string }[] };
    expect(summarized.findings.some((f) => f.id.startsWith('egress:'))).toBe(true);
  });

  it('survives heuristic poll failures without throwing', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.queryTopEgressBySource.mockRejectedValue(new Error('opensearch unavailable'));

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await expect(startInsightEngine({ config: consoleSearchConfig(), insightSink })).resolves.toBeDefined();
  });

  it('forwards summary text to insightSink.postInsight when output is chat', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [sampleFinding], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: slackChatSearchConfig(), insightSink });
    expect(insightSink.postInsight).toHaveBeenCalledWith('summary text');
  });

  it('handles alerting fetch rejection like a failed backend', async () => {
    eng.fetchAlerting.mockRejectedValue(new Error('transport'));
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(eng.queryTopEgressBySource).toHaveBeenCalled();
  });

  it('handles AD fetch rejection like a failed backend', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    eng.fetchAd.mockRejectedValue(new Error('ad down'));
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(eng.queryTopEgressBySource).toHaveBeenCalled();
  });

  it('does not post when heuristics produce no novel findings', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.queryTopEgressBySource.mockResolvedValue([]);
    eng.queryPortscanCandidates.mockResolvedValue([]);
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(insightSink.postInsight).not.toHaveBeenCalled();
  });

  it('sorts multiple heuristic findings by severity (comparator runs)', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.queryTopEgressBySource.mockImplementation((opts: { window: { from: string; to: string } }) =>
      Promise.resolve(egressMockHighSpike(opts)),
    );
    eng.queryPortscanCandidates.mockResolvedValue([
      { srcIp: '10.0.0.8', distinctDstPorts: 160, packets: 300, bytes: 1 },
    ]);

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });

    const summarized = eng.summarizeFindings.mock.calls[0]![0] as { findings: Finding[] };
    expect(summarized.findings.length).toBeGreaterThanOrEqual(2);
    const sevRanks = summarized.findings.map((f) => findingSeverityRank(f.severity));
    const sortedRanks = [...sevRanks].sort((a, b) => b - a);
    expect(sevRanks).toEqual(sortedRanks);
  });

  it('skips proactive post when LLM sets post to false', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [sampleFinding], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    eng.summarizeFindings.mockResolvedValue({ post: false, text: '' });

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(insightSink.postInsight).not.toHaveBeenCalled();
  });

  it('does not call LLM when heuristic findings are only low severity', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: false });
    eng.queryTopEgressBySource.mockImplementation((opts: { window: { from: string; to: string } }) =>
      Promise.resolve(egressMockLowOnly(opts)),
    );
    eng.queryPortscanCandidates.mockResolvedValue([]);

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(eng.summarizeFindings).not.toHaveBeenCalled();
    expect(insightSink.postInsight).not.toHaveBeenCalled();
  });

  it('caps backend findings passed to the LLM at three', async () => {
    const many: Finding[] = Array.from({ length: 5 }, (_, i) => ({
      id: `os-alert:r${i}`,
      kind: 'opensearch_alert' as const,
      severity: 'medium' as const,
      title: `Alert ${i}`,
      summary: 'S',
      evidence: {},
      window: { from: 'a', to: 'b' },
    }));
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: many, healthyEmpty: false });
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });

    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });

    const summarized = eng.summarizeFindings.mock.calls[0]![0] as { findings: Finding[] };
    expect(summarized.findings).toHaveLength(3);
    expect(insightSink.postInsight).toHaveBeenCalled();
  });

  it('stringifies non-Error alerting fetch rejection', async () => {
    eng.fetchAlerting.mockRejectedValue('transport');
    eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(eng.queryTopEgressBySource).toHaveBeenCalled();
  });

  it('stringifies non-Error AD fetch rejection', async () => {
    eng.fetchAlerting.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
    eng.fetchAd.mockRejectedValue('ad string');
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    await startInsightEngine({ config: consoleSearchConfig(), insightSink });
    expect(eng.queryTopEgressBySource).toHaveBeenCalled();
  });

  it('skips scheduled polls after stop when clearInterval is ineffective (abort guard)', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    try {
      const base = consoleSearchConfig();
      const config = { ...base, behavior: { ...base.behavior, pollIntervalSeconds: 1 } };
      const { startInsightEngine } = await import('../src/insights/engine.js');
      const { stop } = await startInsightEngine({
        config,
        insightSink: mockInsightSink(),
      });
      const n = eng.fetchAlerting.mock.calls.length;
      stop();
      await vi.advanceTimersByTimeAsync(1500);
      await vi.runOnlyPendingTimersAsync();
      expect(eng.fetchAlerting.mock.calls.length).toBe(n);
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('does not emit degraded log when backend is not ok but has no warning', async () => {
    const stub = makeInsightsLoggerStub();
    const restoreLogger = installInsightsLoggerSpy(stub);
    try {
      eng.fetchAlerting.mockResolvedValue({ ok: false, findings: [] });
      eng.fetchAd.mockResolvedValue({ ok: true, findings: [], healthyEmpty: true });
      const { startInsightEngine } = await import('../src/insights/engine.js');
      const insightSink = mockInsightSink();
      await startInsightEngine({ config: consoleSearchConfig(), insightSink });
      expect(stub.warn.mock.calls.filter((c) => c[1] === 'insights degraded')).toHaveLength(0);
    } finally {
      restoreLogger();
    }
  });
});

describe('degraded warnings rate limit', () => {
  beforeEach(() => {
    resetEngMocks({
      alerting: { ok: false, findings: [], warning: 'alerting down' },
      ad: { ok: true, findings: [], healthyEmpty: true },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('suppresses repeat degraded logs within the cooldown window', async () => {
    vi.useFakeTimers();
    const stub = makeInsightsLoggerStub();
    installInsightsLoggerSpy(stub);

    const base = consoleSearchConfig();
    const config = { ...base, behavior: { ...base.behavior, pollIntervalSeconds: 1 } };
    const { startInsightEngine } = await import('../src/insights/engine.js');
    const insightSink = mockInsightSink();
    const { stop } = await startInsightEngine({ config, insightSink });

    const degradedCount = () =>
      stub.warn.mock.calls.filter((c) => c[1] === 'insights degraded').length;
    expect(degradedCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1500);
    await vi.runOnlyPendingTimersAsync();
    expect(degradedCount()).toBe(1);

    stop();
  });
});
