import { randomUUID } from 'node:crypto';
import type { KaytooConfig } from '../config.js';
import { getLogger, logErr } from '../logging/logger.js';
import { runWithLogContextAsync } from '../logging/context.js';
import { createThrottle } from '../logging/throttle.js';
import { createSearchClient } from '../search/client.js';
import { waitForOpenSearchFieldMapping } from '../opensearch/waitForFieldMapping.js';
import { queryPortscanCandidates, queryRareDestinationsSignificantTerms } from '../opensearch/queries/index.js';
import { detectPortScans } from '../detectors/portScan.js';
import { detectRareDestinations } from '../detectors/rareDest.js';
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

/** Rare-dest foreground window (aligned with primary egress lookback). */
const RARE_CURRENT_MINUTES = 60;
/** Rare-dest background for significant_terms (same default as rareExternalDestinations tool). */
const RARE_BACKGROUND_MINUTES = 7 * 24 * 60;

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
  const shouldWarnDegraded = createThrottle(10 * 60_000);
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

        if (shouldSkipHeuristicPoll(alerting, ad)) {
          log.debug('skipping heuristic detectors: alerting and AD healthy empty');
          return;
        }

        const portscanMinutes = 5;
        const rareCurrentWindow = windowRelative({ to: now, minutesBack: RARE_CURRENT_MINUTES });
        const rareBackgroundWindow = windowRelative({ to: now, minutesBack: RARE_BACKGROUND_MINUTES });
        const portscanWindow = windowRelative({ to: now, minutesBack: portscanMinutes });

        const [rareRows, portscanRows] = await Promise.all([
          queryRareDestinationsSignificantTerms({
            client,
            index: config.search.indexPattern,
            fields,
            window: rareCurrentWindow,
            backgroundWindow: rareBackgroundWindow,
            size: 15,
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
          ...detectRareDestinations({ window: rareCurrentWindow, rows: rareRows }),
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
