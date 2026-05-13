import { randomUUID } from 'node:crypto';
import type { KaytooConfig } from '../config.js';
import type { Logger } from 'pino';
import { getLogger, logErr } from '../logging/logger.js';
import { runWithLogContextAsync } from '../logging/context.js';
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
import {
  fetchOpenSearchAdFindings,
  fetchOpenSearchAlertingFindings,
  type DetectionFetchResult,
} from './opensearchDetections.js';
import { selectNovelInsightPostBatch, shouldSkipHeuristicPoll } from './pollUtils.js';
import { enrichInsightsEgressBatch } from './enrichEgressEvidence.js';
import { egressInsightWindows } from './egressInsightPolicy.js';

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

  const llm = createOpenAiCompatClient({
    ...config.llm,
    includeDebugBodies: config.logging.includeDebugBodies,
  });
  const dedupe = new DedupeStore(config.behavior.dedupeTtlSeconds * 1000);
  const warnAt = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;

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

        const [alerting, ad] =
          config.search.backend === 'opensearch'
            ? await Promise.all([
                fetchOpenSearchAlertingFindings({
                  client,
                  now,
                  minutesBack: config.behavior.pollIntervalSeconds / 60 + 5,
                }).catch(detectionFetchFailure),
                fetchOpenSearchAdFindings({
                  client,
                  minutesBack: config.behavior.pollIntervalSeconds / 60 + 10,
                }).catch(detectionFetchFailure),
              ])
            : ([{ ok: true, findings: [], healthyEmpty: false } as DetectionFetchResult, { ok: true, findings: [], healthyEmpty: false } as DetectionFetchResult] satisfies [
                DetectionFetchResult,
                DetectionFetchResult,
              ]);

        if (!alerting.ok && alerting.warning) rateLimitedWarn(log, warnAt, 'alerting', alerting.warning);
        if (!ad.ok && ad.warning) rateLimitedWarn(log, warnAt, 'ad', ad.warning);

        const backendFindings = [...alerting.findings, ...ad.findings];
        if (backendFindings.length > 0) {
          await postFindings(backendFindings);
          return;
        }

        if (shouldSkipHeuristicPoll(alerting, ad)) {
          log.debug('skipping heuristic detectors: alerting and AD healthy empty');
          return;
        }

        const { primary, spike } = egressInsightWindows;
        const portscanMinutes = 5;

        const baselineWindow = windowRelative({ to: now, minutesBack: primary.baselineMinutes });
        const primaryCurrentWindow = windowRelative({ to: now, minutesBack: primary.currentMinutes });
        const spikeCurrentWindow = windowRelative({ to: now, minutesBack: spike.currentMinutes });
        const portscanWindow = windowRelative({ to: now, minutesBack: portscanMinutes });

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
      // Notifier already logged the cause; record outcome only and skip dedupe so the next poll retries.
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

function rateLimitedWarn(log: Logger, map: Map<string, number>, key: string, msg: string): void {
  const now = Date.now();
  const next = map.get(key) ?? 0;
  if (now < next) return;
  log.warn({ degradedKey: key, degradedMsg: msg }, 'insights degraded');
  map.set(key, now + 10 * 60_000);
}
