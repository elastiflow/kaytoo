import { randomUUID } from 'node:crypto';
import type { KaytooConfig } from '../config.js';
import { getLogger, logErr } from '../logging/logger.js';
import { runWithLogContextAsync } from '../logging/context.js';
import { createThrottle } from '../logging/throttle.js';
import { createSearchClient } from '../search/client.js';
import { waitForOpenSearchFieldMapping } from '../opensearch/waitForFieldMapping.js';
import { queryPortscanCandidates, queryTopEgressBySource } from '../opensearch/queries/index.js';
import { detectEgressAnomalies } from '../detectors/egressAnomaly.js';
import { detectPortScans } from '../detectors/portScan.js';
import type { Finding } from '../detectors/types.js';
import { createOpenAiCompatClient } from '../llm/openaiCompat.js';
import type { InsightSink } from '../notify/insightSink.js';
import { DedupeStore } from '../state/dedupe.js';
import { thrownMessage } from '../util/guards.js';
import { windowRelative } from '../util/time.js';
import type { DetectionFetchResult } from './opensearchDetections.js';
import { selectNovelInsightPostBatch, shouldSkipHeuristicPoll } from './pollUtils.js';
import { enrichInsightsEgressBatch } from './enrichEgressEvidence.js';
import { egressInsightWindows } from './egressInsightPolicy.js';
import { ensureNativeAnomalyPipeline } from './nativeAnomalyPipeline.js';
import { fetchNativeAlertFindings, fetchNativeAnomalyFindings } from './nativeDetections.js';
import type { NativeAnomalyPipelineResult } from './nativeAnomalyTypes.js';
import type { ElasticsearchMlClient } from '../elasticsearch/mlAnomalyLifecycle.js';

function detectionFetchFailure(e: unknown): DetectionFetchResult {
  return { ok: false, findings: [], warning: thrownMessage(e) };
}

export async function startInsightEngine(opts: { config: KaytooConfig; insightSink: InsightSink }): Promise<{
  stop: () => void;
}> {
  const { config } = opts;
  const log = getLogger({ component: 'insights' });
  const controller = new AbortController();

  if (config.behavior.pollIntervalSeconds <= 0) {
    log.info({ pollSeconds: config.behavior.pollIntervalSeconds }, 'insight polling disabled');
    return { stop: () => controller.abort() };
  }

  const client = await createSearchClient(config.search);
  const fields = await waitForOpenSearchFieldMapping({
    client,
    indexPattern: config.search.indexPattern,
    log,
    signal: controller.signal,
  });
  log.info(
    {
      srcIpField: fields.srcIpField,
      bytesField: fields.bytesField,
      dstIpField: fields.dstIpField,
      srcDisplayNameField: fields.srcDisplayNameField,
      dstDisplayNameField: fields.dstDisplayNameField,
    },
    'resolved opensearch field mapping',
  );

  let nativePipeline: NativeAnomalyPipelineResult = { ok: false, hasScopedSources: false };
  let esMlClient: ElasticsearchMlClient | null = null;
  try {
    const ensured = await ensureNativeAnomalyPipeline({
      backend: config.search.backend,
      search: config.search,
      searchClient: client,
      indexPattern: config.search.indexPattern,
      fields,
      pollIntervalSeconds: config.behavior.pollIntervalSeconds,
    });
    nativePipeline = ensured.pipeline;
    esMlClient = ensured.esMlClient;
  } catch (e) {
    log.warn({ ...logErr(e) }, 'native anomaly pipeline ensure failed; continuing without scoped native anomaly');
  }

  const llm = createOpenAiCompatClient({
    ...config.llm,
    includeDebugBodies: config.logging.includeDebugBodies,
  });
  const dedupe = new DedupeStore(config.behavior.dedupeTtlSeconds * 1000);
  const shouldWarnDegraded = createThrottle(10 * 60_000);
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;

  const nativePipelineReady = nativePipeline.ok === true && nativePipeline.hasScopedSources === true;

  const scheduleNext = (): void => {
    if (controller.signal.aborted) return;
    timer = setTimeout(() => void pollOnce(), config.behavior.pollIntervalSeconds * 1000);
  };

  async function pollOnce(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    return runWithLogContextAsync({ pollId: randomUUID() }, async () => {
      try {
        if (controller.signal.aborted) return;

        const now = new Date();

        const [alerting, ad] = await Promise.all([
          fetchNativeAlertFindings({
            backend: config.search.backend,
            client,
            now,
            minutesBack: config.behavior.pollIntervalSeconds / 60 + 5,
          }).catch(detectionFetchFailure),
          fetchNativeAnomalyFindings({
            backend: config.search.backend,
            searchClient: client,
            esMlClient,
            pipeline: nativePipeline,
            now,
            minutesBack: config.behavior.pollIntervalSeconds / 60 + 10,
          }).catch(detectionFetchFailure),
        ]);

        if (!alerting.ok && alerting.warning && shouldWarnDegraded('alerting')) {
          log.warn({ degradedKey: 'alerting', degradedMsg: alerting.warning }, 'insights degraded');
        }
        if (!ad.ok && ad.warning && shouldWarnDegraded('ad')) {
          log.warn({ degradedKey: 'ad', degradedMsg: ad.warning }, 'insights degraded');
        }

        const backendFindings = [...alerting.findings, ...ad.findings];
        if (backendFindings.length > 0) {
          await postFindings(backendFindings);
          return;
        }

        if (shouldSkipHeuristicPoll(alerting, ad, nativePipelineReady)) {
          log.debug('skipping heuristic detectors: alerting and AD healthy empty with native pipeline ready');
          return;
        }

        const { primary, spike } = egressInsightWindows;
        const portscanMinutes = 5;

        const baselineWindow = windowRelative({ to: now, minutesBack: primary.baselineMinutes });
        const primaryCurrentWindow = windowRelative({ to: now, minutesBack: primary.currentMinutes });
        const spikeCurrentWindow = windowRelative({ to: now, minutesBack: spike.currentMinutes });
        const portscanWindow = windowRelative({ to: now, minutesBack: portscanMinutes });

        // Three queryTopEgressBySource calls: primary window, spike window, shared baseline.
        const [primaryCurrentEgress, spikeCurrentEgress, baselineEgress, portscanRows] = await Promise.all([
          queryTopEgressBySource({
            client,
            index: config.search.indexPattern,
            fields,
            window: primaryCurrentWindow,
            size: 25,
          }),
          queryTopEgressBySource({
            client,
            index: config.search.indexPattern,
            fields,
            window: spikeCurrentWindow,
            size: 25,
          }),
          queryTopEgressBySource({
            client,
            index: config.search.indexPattern,
            fields,
            window: baselineWindow,
            size: 200,
          }),
          queryPortscanCandidates({
            client,
            index: config.search.indexPattern,
            fields,
            window: portscanWindow,
            size: 50,
          }),
        ]);

        const findings: Finding[] = [
          ...detectEgressAnomalies({
            mode: 'primary',
            window: primaryCurrentWindow,
            current: primaryCurrentEgress,
            baseline: baselineEgress,
            thresholds: config.thresholds,
            baselineMinutes: primary.baselineMinutes,
            currentMinutes: primary.currentMinutes,
          }),
          ...detectEgressAnomalies({
            mode: 'spike',
            window: spikeCurrentWindow,
            current: spikeCurrentEgress,
            baseline: baselineEgress,
            thresholds: config.thresholds,
            baselineMinutes: spike.baselineMinutes,
            currentMinutes: spike.currentMinutes,
          }),
          ...detectPortScans({
            window: portscanWindow,
            rows: portscanRows,
            thresholds: config.thresholds,
          }),
        ];

        const novel = findings.filter((f) => !dedupe.has(f.id));
        if (novel.length === 0) {
          log.debug('no new findings this poll');
          return;
        }

        await postFindings(findings);
      } catch (e) {
        log.error({ ...logErr(e) }, 'poll failed');
      } finally {
        inFlight = false;
        scheduleNext();
      }
    });
  }

  async function postFindings(findings: Finding[]): Promise<void> {
    const toPost = selectNovelInsightPostBatch(findings, dedupe);
    if (toPost.length === 0) return;

    const toSummarize = await enrichInsightsEgressBatch({
      client,
      index: config.search.indexPattern,
      fields,
      findings: toPost,
      log,
    });

    const summary = await llm.summarizeFindings({ channelStyle: 'slack', findings: toSummarize }).catch((e) => {
      log.warn({ ...logErr(e), findingCount: toPost.length }, 'LLM summarization failed; skipping proactive post');
      return null;
    });

    if (summary === null) return;

    if (!summary.post || !summary.text.trim()) {
      log.debug({ findingCount: toPost.length, post: summary.post }, 'LLM declined proactive insight post');
      return;
    }

    const text = summary.text.trim();

    try {
      await opts.insightSink.postInsight(text);
    } catch {
      // Notifier logged the error; omit dedupe.mark so this batch can retry next poll.
      log.warn({ findingCount: toPost.length, output: config.output }, 'post findings failed');
      return;
    }
    toPost.forEach((f) => dedupe.mark(f.id));
    log.info({ findingCount: toPost.length, output: config.output }, 'posted findings');
  }

  await pollOnce();

  return {
    stop: () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    },
  };
}
