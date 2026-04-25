import { parseKaytooArgv } from './cli/argv.js';
import { getConfig } from './config.js';
import { createSlackNotifierWithRetry } from './notify/slack.js';
import { createConsoleInsightSink } from './notify/consoleInsightSink.js';
import { startInsightEngine } from './insights/engine.js';
import { ChatRouter } from './chat/router.js';
import { startSlackSocketAdapter } from './chat/adapters/slackSocket.js';
import { startMatrixAdapter } from './chat/adapters/matrix.js';
import { startMattermostAdapter } from './chat/adapters/mattermost.js';
import { createAgentRuntime } from './agent/runtime.js';
import { createSlackChatNotifier } from './notify/slackNotifier.js';
import { createMatrixNotifier } from './notify/matrixNotifier.js';
import { createMattermostNotifier } from './notify/mattermostNotifier.js';
import { createMultiNotifier, createPromiseBackedNotifier } from './notify/multiNotifier.js';
import { getLogger, initLogging } from './logging/logger.js';
import { startE2eHttpChatServer } from './e2eHttpChatServer.js';

const argv = parseKaytooArgv();
const config = getConfig(process.env, argv);
const { level, redactPaths, nodeEnv } = config.logging;
initLogging({ level, redactPaths, nodeEnv });
const log = getLogger({ component: 'main' });
log.info(
  { indexPattern: config.search.indexPattern, pollSeconds: config.behavior.pollIntervalSeconds, output: config.output },
  'kaytoo starting',
);

const insightSink =
  config.output === 'console'
    ? createConsoleInsightSink(getLogger({ component: 'insights.out' }))
    : createSlackNotifierWithRetry({ botToken: config.slack!.botToken!, log: getLogger({ component: 'notify.slack' }) });

// Bind e2e HTTP chat before the insight engine: the engine awaits the first poll, which can take a long time
// (OpenSearch + LLM) and would otherwise block /health and /chat until that poll finishes.
const httpChatBind = config.output === 'console' ? (config.httpChatBind ?? '') : '';
if (httpChatBind) {
  await startE2eHttpChatServer({
    config,
    bind: httpChatBind,
    log: getLogger({ component: 'e2e.http' }),
  });
}

await startInsightEngine({ config, insightSink });

if (config.output === 'console') {
  log.info(
    { httpChat: Boolean(httpChatBind) },
    'console output mode: insight polling (Slack/Matrix/Mattermost adapters off unless KAYTOO_HTTP_CHAT_BIND set)',
  );
} else {
  const slackCfg = config.slack!;
  const slack = insightSink;
  const slackNotifier = createSlackChatNotifier({ slack });
  // Adapters call `onEvent` as soon as they connect; the router is created later, so we
  // resolve the router through a promise until `ChatRouter` is constructed below.
  const routerCtl = Promise.withResolvers<ChatRouter>();

  const onEvent = async (evt: Parameters<ChatRouter['handleEvent']>[0]) => {
    await (await routerCtl.promise).handleEvent(evt);
  };

  const matrixNotifierP = config.matrix
    ? startMatrixAdapter({
        homeserverUrl: config.matrix.homeserver,
        accessToken: config.matrix.accessToken,
        matrixSdkLevel: config.logging.matrixSdkLevel,
        ...(config.matrix.defaultRoomId ? { defaultRoomId: config.matrix.defaultRoomId } : {}),
        onEvent,
      }).then((started) => createMatrixNotifier(started.client))
    : Promise.resolve(null);

  const mattermostNotifier = config.mattermost
    ? createMattermostNotifier({ baseUrl: config.mattermost.url, token: config.mattermost.token })
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

  const notifier = createMultiNotifier({
    slack: slackNotifier,
    ...(config.matrix
      ? { matrix: createPromiseBackedNotifier(matrixNotifierP, 'Matrix notifier not configured') }
      : {}),
    ...(mattermostNotifier ? { mattermost: mattermostNotifier } : {}),
  });

  const agent = await createAgentRuntime({ config });

  const router = new ChatRouter({ notifier, agent, status: async () => 'kaytoo: ok' });
  routerCtl.resolve(router);

  await startSlackSocketAdapter({ appToken: slackCfg.appToken!, onEvent });
}
