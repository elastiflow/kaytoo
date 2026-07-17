import { z } from 'zod';

const intFromString = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((v) => Number.parseInt(v, 10));

const boolFromString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const logLevelSchema = z
  .string()
  .optional()
  .transform((s) => (s ?? 'info').toLowerCase())
  .pipe(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).catch('info'));

const matrixSdkLogLevelSchema = z
  .string()
  .optional()
  .transform((s) => (s ?? 'warn').toUpperCase())
  .pipe(z.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']).catch('WARN'));

const commaList = z
  .string()
  .optional()
  .transform((s) =>
    s
      ? s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  );

function optStr(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
}

const slackFieldsSchema = z.object({
  botToken: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  appToken: z.string().min(1).optional(),
});

const searchConfigSchema = z.object({
  backend: z.enum(['opensearch', 'elasticsearch']),
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  tlsInsecure: z.string().default('false').pipe(boolFromString),
  indexPattern: z.string().min(1).default('elastiflow-flow-codex-*'),
  mcpUrl: z.string().url().optional(),
});

const configSchema = z
  .object({
    output: z.enum(['chat', 'console']),
    /** When `output` is console: optional bind address for the e2e HTTP chat server (`KAYTOO_HTTP_CHAT_BIND`). */
    httpChatBind: z.string().optional(),
    slack: slackFieldsSchema.optional(),
    matrix: z
      .object({
        homeserver: z.string().url(),
        defaultRoomId: z.string().min(1),
        accessToken: z.string().min(1).optional(),
        user: z.string().min(1).optional(),
        password: z.string().min(1).optional(),
      })
      .refine((m) => !!m.accessToken || (!!m.user && !!m.password), {
        message: 'Matrix requires MATRIX_ACCESS_TOKEN or both MATRIX_USER and MATRIX_PASSWORD',
        path: ['accessToken'],
      })
      .optional(),
    mattermost: z
      .object({
        url: z.string().url(),
        token: z.string().min(1),
        channelId: z.string().min(1),
        botUserId: z.string().min(1).optional(),
      })
      .optional(),
    search: searchConfigSchema,
    llm: z.object({
      baseUrl: z.string().url('LLM_BASE_URL must be a valid URL'),
      apiKey: z.string().min(1, 'LLM_API_KEY is required'),
      model: z.string().min(1).default('gpt-5.4-codex'),
    }),
    behavior: z.object({
      pollIntervalSeconds: z.string().default('300').pipe(intFromString),
      dedupeTtlSeconds: z.string().default('3600').pipe(intFromString),
    }),
    thresholds: z.object({
      egressMultiplier: z.coerce.number().finite().positive().default(3),
      egressMinBytes: z.coerce.number().finite().nonnegative().default(50_000_000),
      portscanDistinctDstPorts: z.coerce.number().int().positive().default(50),
      portscanMinPackets: z.coerce.number().int().positive().default(200),
    }),
    logging: z.object({
      level: logLevelSchema,
      includeDebugBodies: z.string().default('false').pipe(boolFromString),
      redactPaths: commaList,
      matrixSdkLevel: matrixSdkLogLevelSchema,
    }),
    conversation: z.object({
      /** When set, persist thread memory to this JSON file; otherwise in-process memory only. */
      storePath: z.string().min(1).optional(),
      ttlSeconds: z.coerce.number().int().positive().default(604_800),
      maxTurns: z.coerce.number().int().positive().default(20),
      summarizeAfterTurns: z.coerce.number().int().positive().default(12),
    }),
    knowledge: z.object({
      /** Directory of .md/.txt docs for kbSearch tool */
      docsDir: z.string().min(1).optional(),
      maxSnippetChars: z.coerce.number().int().positive().default(800),
    }),
    agent: z.object({
      /** Optional JSON-RPC endpoint for MCP-style tool invocation (server-specific). */
      mcpJsonRpcUrl: z.string().url().optional(),
      mcpJsonRpcBearer: z.string().optional(),
      /** If non-empty, only these tool names are exposed (comma-separated). */
      toolAllowlist: commaList,
      maxAggDepth: z.coerce.number().int().positive().max(12).default(4),
      maxAggsNodes: z.coerce.number().int().positive().max(80).default(28),
      aggregateRequestTimeoutMs: z.coerce.number().int().positive().max(120_000).default(25_000),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.output !== 'chat') return;

    const s = data.slack;
    const partialSlack = !!(s?.botToken || s?.channelId || s?.appToken);
    if (partialSlack) {
      const need = (ok: boolean, path: ['slack', string], msg: string) => {
        if (!ok) ctx.addIssue({ code: 'custom', message: msg, path });
      };
      need(!!s?.botToken, ['slack', 'botToken'], 'SLACK_BOT_TOKEN is required when Slack env is set');
      need(!!s?.channelId, ['slack', 'channelId'], 'SLACK_CHANNEL_ID is required when Slack env is set');
      need(!!s?.appToken, ['slack', 'appToken'], 'SLACK_APP_TOKEN is required when Slack env is set');
    }

    if (!data.slack && !data.matrix && !data.mattermost) {
      ctx.addIssue({
        code: 'custom',
        message: 'Chat mode requires Slack, Matrix, or Mattermost configuration',
        path: ['output'],
      });
    }
  });

export type KaytooConfig = z.infer<typeof configSchema>;

export type GetConfigOptions = {
  /** When set, forces the effective `output` field. */
  outputOverride?: KaytooConfig['output'];
};

function slackFromEnv(env: NodeJS.ProcessEnv) {
  if (!optStr(env.SLACK_BOT_TOKEN) && !optStr(env.SLACK_CHANNEL_ID) && !optStr(env.SLACK_APP_TOKEN)) return undefined;
  return {
    botToken: optStr(env.SLACK_BOT_TOKEN),
    channelId: optStr(env.SLACK_CHANNEL_ID),
    appToken: optStr(env.SLACK_APP_TOKEN),
  };
}

function matrixFromEnv(env: NodeJS.ProcessEnv) {
  const homeserver = optStr(env.MATRIX_HOMESERVER);
  const accessToken = optStr(env.MATRIX_ACCESS_TOKEN);
  const user = optStr(env.MATRIX_USER);
  const password = optStr(env.MATRIX_PASSWORD);
  const defaultRoomId = optStr(env.MATRIX_DEFAULT_ROOM_ID);
  if (!homeserver && !accessToken && !user && !password && !defaultRoomId) return undefined;
  return {
    homeserver,
    defaultRoomId,
    ...(accessToken ? { accessToken } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}

function mattermostFromEnv(env: NodeJS.ProcessEnv) {
  if (!env.MATTERMOST_URL || !env.MATTERMOST_TOKEN || !env.MATTERMOST_CHANNEL_ID) return undefined;
  return {
    url: env.MATTERMOST_URL,
    token: env.MATTERMOST_TOKEN,
    channelId: env.MATTERMOST_CHANNEL_ID,
    botUserId: env.MATTERMOST_BOT_USER_ID,
  };
}

function hasMattermostEnvHint(env: NodeJS.ProcessEnv): boolean {
  return !!(
    optStr(env.MATTERMOST_URL) ||
    optStr(env.MATTERMOST_TOKEN) ||
    optStr(env.MATTERMOST_CHANNEL_ID) ||
    optStr(env.MATTERMOST_BOT_USER_ID)
  );
}

function envHintsChatOutput(env: NodeJS.ProcessEnv): boolean {
  return !!(slackFromEnv(env) || matrixFromEnv(env) || hasMattermostEnvHint(env));
}

function resolveOutput(env: NodeJS.ProcessEnv, opts?: GetConfigOptions): KaytooConfig['output'] {
  if (opts?.outputOverride) return opts.outputOverride;
  return envHintsChatOutput(env) ? 'chat' : 'console';
}

function resolveSearchBackend(env: NodeJS.ProcessEnv): KaytooConfig['search']['backend'] {
  const hasOs = optStr(env.OPENSEARCH_URL) != null;
  const hasEs = optStr(env.ELASTICSEARCH_URL) != null;
  if (hasOs && hasEs) throw new Error('Invalid configuration: set only one of OPENSEARCH_URL or ELASTICSEARCH_URL');
  if (hasEs) return 'elasticsearch';
  return 'opensearch';
}

function pickSearchVars(
  env: NodeJS.ProcessEnv,
  backend: KaytooConfig['search']['backend'],
): {
  url: string | undefined;
  username: string | undefined;
  password: string | undefined;
  tlsInsecure: string | undefined;
  indexPattern: string | undefined;
  mcpUrl: string | undefined;
} {
  if (backend === 'elasticsearch') {
    return {
      url: env.ELASTICSEARCH_URL,
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_PASSWORD,
      tlsInsecure: env.ELASTICSEARCH_TLS_INSECURE,
      indexPattern: env.ELASTICSEARCH_INDEX_PATTERN,
      mcpUrl: env.ELASTICSEARCH_MCP_URL,
    };
  }
  return {
    url: env.OPENSEARCH_URL,
    username: env.OPENSEARCH_USERNAME,
    password: env.OPENSEARCH_PASSWORD,
    tlsInsecure: env.OPENSEARCH_TLS_INSECURE,
    indexPattern: env.OPENSEARCH_INDEX_PATTERN,
    mcpUrl: env.OPENSEARCH_MCP_URL,
  };
}

export function getConfig(env: NodeJS.ProcessEnv = process.env, opts?: GetConfigOptions): KaytooConfig {
  const output = resolveOutput(env, opts);
  const backend = resolveSearchBackend(env);
  const picked = pickSearchVars(env, backend);

  const kb = optStr(env.KAYTOO_KB_DOCS_DIR);
  const parsed = configSchema.safeParse({
    output,
    httpChatBind: optStr(env.KAYTOO_HTTP_CHAT_BIND),
    slack: slackFromEnv(env),
    matrix: matrixFromEnv(env),
    mattermost: mattermostFromEnv(env),
    search: {
      backend,
      url: picked.url,
      username: picked.username,
      password: picked.password,
      tlsInsecure: picked.tlsInsecure ?? 'false',
      indexPattern: picked.indexPattern ?? 'elastiflow-flow-codex-*',
      mcpUrl: picked.mcpUrl,
    },
    llm: {
      baseUrl: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
    },
    behavior: {
      pollIntervalSeconds: optStr(env.KAYTOO_POLL_INTERVAL_SECONDS),
      dedupeTtlSeconds: optStr(env.KAYTOO_DEDUPE_TTL_SECONDS),
    },
    thresholds: {
      egressMultiplier: optStr(env.KAYTOO_EGRESS_MULTIPLIER),
      egressMinBytes: optStr(env.KAYTOO_EGRESS_MIN_BYTES),
      portscanDistinctDstPorts: optStr(env.KAYTOO_PORTSCAN_DISTINCT_DST_PORTS),
      portscanMinPackets: optStr(env.KAYTOO_PORTSCAN_MIN_PACKETS),
    },
    logging: { level: env.LOG_LEVEL },
    conversation: {},
    knowledge: kb ? { docsDir: kb } : {},
    agent: {
      mcpJsonRpcUrl: optStr(env.KAYTOO_MCP_JSONRPC_URL),
      mcpJsonRpcBearer: optStr(env.KAYTOO_MCP_JSONRPC_BEARER),
      toolAllowlist: env.KAYTOO_AGENT_TOOL_ALLOWLIST,
    },
  });

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${formatted}`);
  }

  return parsed.data;
}
