import { parseKaytooArgv } from './cli/argv.js';
import { getConfig } from './config.js';
import { createConsoleInsightSink } from './notify/consoleInsightSink.js';
import { createMultiInsightSink, createPlatformInsightSink, type InsightSink } from './notify/insightSink.js';
import { startInsightEngine } from './insights/engine.js';
import { getLogger, initLogging } from './logging/logger.js';
import { startE2eHttpChatServer } from './e2eHttpChatServer.js';
import type { ChatRouter as ChatRouterT } from './chat/router.js';
import type { Notifier } from './notify/notifier.js';
import type { ChatPlatform } from './chat/types.js';

type ChatInsightPlatform = Exclude<ChatPlatform, 'e2e'>;

function notifierBundle(opts: {
  slack?: Notifier | undefined;
  matrix?: Notifier | undefined;
  mattermost?: Notifier | undefined;
}): { slack?: Notifier; matrix?: Notifier; mattermost?: Notifier } {
  const out: { slack?: Notifier; matrix?: Notifier; mattermost?: Notifier } = {};
  if (opts.slack) out.slack = opts.slack;
  if (opts.matrix) out.matrix = opts.matrix;
  if (opts.mattermost) out.mattermost = opts.mattermost;
  return out;
}

function insightSinksFromRows(
  rows: ReadonlyArray<{
    platform: ChatInsightPlatform;
    notifier: Notifier | undefined;
    channelId: string | undefined;
  }>,
): InsightSink[] {
  const sinks: InsightSink[] = [];
  for (const { platform, notifier, channelId } of rows) {
    if (notifier && channelId) sinks.push(createPlatformInsightSink(notifier, { platform, channelId }));
  }
  return sinks;
}

const argv = parseKaytooArgv();
const config = getConfig(process.env, argv);
const { level, redactPaths } = config.logging;
initLogging({ level, redactPaths });
const log = getLogger({ component: 'main' });
log.info(
  { indexPattern: config.search.indexPattern, pollSeconds: config.behavior.pollIntervalSeconds, output: config.output },
  'kaytoo starting',
);

const httpChatBind = config.output === 'console' ? (config.httpChatBind ?? '') : '';
if (httpChatBind) {
  await startE2eHttpChatServer({
    config,
    bind: httpChatBind,
    log: getLogger({ component: 'e2e.http' }),
  });
}

if (config.output === 'console') {
  const insightSink = createConsoleInsightSink(getLogger({ component: 'insights.out' }));
  await startInsightEngine({ config, insightSink });
  log.info(
    { httpChat: Boolean(httpChatBind) },
    'console output mode: insight polling (Slack/Matrix/Mattermost adapters off unless KAYTOO_HTTP_CHAT_BIND set)',
  );
} else {
  const routerCtl = Promise.withResolvers<ChatRouterT>();
  const onEvent = async (evt: Parameters<ChatRouterT['handleEvent']>[0]) => {
    await (await routerCtl.promise).handleEvent(evt);
  };

  const [
    { ChatRouter },
    { createAgentRuntime },
    notify,
    slackSocket,
    matrixAdapter,
    mattermostAdapter,
    retry,
    slackApi,
    slackChat,
    matrixNotify,
    mattermostNotify,
  ] = await Promise.all([
    import('./chat/router.js'),
    import('./agent/runtime.js'),
    import('./notify/multiNotifier.js'),
    import('./chat/adapters/slackSocket.js'),
    import('./chat/adapters/matrix.js'),
    import('./chat/adapters/mattermost.js'),
    import('./notify/retryNotifier.js'),
    import('./notify/slack.js'),
    import('./notify/slackNotifier.js'),
    import('./notify/matrixNotifier.js'),
    import('./notify/mattermostNotifier.js'),
  ]);

  const { createMultiNotifier, createPromiseBackedNotifier } = notify;
  const { startSlackSocketAdapter } = slackSocket;
  const { startMatrixAdapter } = matrixAdapter;
  const { startMattermostAdapter } = mattermostAdapter;
  const { createRetryNotifier, isRetryableMatrixError, isRetryableMattermostHttpError } = retry;

  const slackWeb = config.slack?.botToken
    ? slackApi.createSlackNotifierWithRetry({
        botToken: config.slack.botToken,
        log: getLogger({ component: 'notify.slack' }),
      })
    : null;
  const slackNotifier =
    slackWeb && config.slack ? slackChat.createSlackChatNotifier({ slack: slackWeb }) : undefined;

  const matrixNotifier: Notifier | undefined = config.matrix
    ? createPromiseBackedNotifier(
        startMatrixAdapter({
          homeserverUrl: config.matrix.homeserver,
          accessToken: config.matrix.accessToken,
          matrixSdkLevel: config.logging.matrixSdkLevel,
          defaultRoomId: config.matrix.defaultRoomId,
          onEvent,
        }).then((started) =>
          createRetryNotifier({
            inner: matrixNotify.createMatrixNotifier(started.client),
            log: getLogger({ component: 'notify.matrix' }),
            label: 'matrix.post',
            isRetryable: isRetryableMatrixError,
          }),
        ),
        'Matrix notifier not configured',
      )
    : undefined;

  const mattermostNotifier: Notifier | undefined = config.mattermost
    ? createRetryNotifier({
        inner: mattermostNotify.createMattermostNotifier({
          baseUrl: config.mattermost.url,
          token: config.mattermost.token,
        }),
        log: getLogger({ component: 'notify.mattermost' }),
        label: 'mattermost.post',
        isRetryable: isRetryableMattermostHttpError,
      })
    : undefined;

  if (config.mattermost) {
    startMattermostAdapter({
      baseUrl: config.mattermost.url,
      token: config.mattermost.token,
      channelId: config.mattermost.channelId,
      ...(config.mattermost.botUserId ? { botUserId: config.mattermost.botUserId } : {}),
      onEvent,
    });
  }

  const notifier = createMultiNotifier(
    notifierBundle({ slack: slackNotifier, matrix: matrixNotifier, mattermost: mattermostNotifier }),
  );

  const insightSink = createMultiInsightSink({
    sinks: insightSinksFromRows([
      { platform: 'slack', notifier: slackNotifier, channelId: config.slack?.channelId },
      { platform: 'matrix', notifier: matrixNotifier, channelId: config.matrix?.defaultRoomId },
      { platform: 'mattermost', notifier: mattermostNotifier, channelId: config.mattermost?.channelId },
    ]),
    log: getLogger({ component: 'insights.out' }),
  });

  const agent = await createAgentRuntime({ config });
  const router = new ChatRouter({ notifier, agent, status: async () => 'kaytoo: ok' });
  routerCtl.resolve(router);

  log.info(
    { slack: Boolean(slackNotifier), matrix: Boolean(matrixNotifier), mattermost: Boolean(mattermostNotifier) },
    'chat adapters ready',
  );

  await startInsightEngine({ config, insightSink });

  if (config.slack?.appToken) {
    await startSlackSocketAdapter({ appToken: config.slack.appToken, onEvent });
  }
}
