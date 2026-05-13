import { describe, expect, it } from 'vitest';
import { getConfig } from '../src/config.js';

describe('getConfig', () => {
  const baseEnv = {
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    SLACK_CHANNEL_ID: 'C123',
    OPENSEARCH_URL: 'https://opensearch.example.com',
    OPENSEARCH_USERNAME: 'user',
    OPENSEARCH_PASSWORD: 'pass',
    LLM_BASE_URL: 'https://llm.example.com',
    LLM_API_KEY: 'key',
  } satisfies Record<string, string>;

  it('parses required env vars and applies defaults', () => {
    const cfg = getConfig(baseEnv);

    expect(cfg.output).toBe('chat');
    expect(cfg.slack?.botToken).toBe('xoxb-test');
    expect(cfg.search.tlsInsecure).toBe(false);
    expect(cfg.search.indexPattern).toBe('elastiflow-flow-codex-*');
    expect(cfg.search.backend).toBe('opensearch');
    expect(cfg.llm.model).toBe('gpt-5.4-codex');
    expect(cfg.behavior.pollIntervalSeconds).toBe(300);
    expect(cfg.behavior.dedupeTtlSeconds).toBe(3600);
    expect(cfg.logging.level).toBe('info');
    expect(cfg.logging.includeDebugBodies).toBe(false);
    expect(cfg.logging.redactPaths).toEqual([]);
    expect(cfg.logging.matrixSdkLevel).toBe('WARN');
    expect(cfg.conversation.ttlSeconds).toBe(604_800);
    expect(cfg.conversation.maxTurns).toBe(20);
    expect(cfg.conversation.summarizeAfterTurns).toBe(12);
    expect(cfg.conversation.storePath).toBeUndefined();
    expect(cfg.behavior.insightDedupePath).toBeUndefined();
    expect(cfg.knowledge.docsDir).toBeUndefined();
    expect(cfg.knowledge.maxSnippetChars).toBe(800);
    expect(cfg.agent.toolAllowlist).toEqual([]);
    expect(
      getConfig({ ...baseEnv, KAYTOO_AGENT_TOOL_ALLOWLIST: 'searchFlows, topTalkersByBytes' }).agent.toolAllowlist,
    ).toEqual(['searchFlows', 'topTalkersByBytes']);
    expect(cfg.agent.mcpJsonRpcUrl).toBeUndefined();
    expect(cfg.agent.maxAggDepth).toBe(4);
    expect(cfg.agent.maxAggsNodes).toBe(28);
    expect(cfg.agent.aggregateRequestTimeoutMs).toBe(25_000);
  });

  it('parses KAYTOO_INSIGHT_DEDUPE_PATH when set', () => {
    const cfg = getConfig({
      ...baseEnv,
      KAYTOO_INSIGHT_DEDUPE_PATH: '/data/insight-dedupe.json',
    });
    expect(cfg.behavior.insightDedupePath).toBe('/data/insight-dedupe.json');
  });

  it('supports numeric overrides and boolean strings', () => {
    const cfg = getConfig({
      ...baseEnv,
      OPENSEARCH_TLS_INSECURE: 'true',
      LLM_MODEL: 'test-model',
      OPENSEARCH_INDEX_PATTERN: 'foo-*',
      LOG_LEVEL: 'debug',
    });

    expect(cfg.search.tlsInsecure).toBe(true);
    expect(cfg.behavior.pollIntervalSeconds).toBe(300);
    expect(cfg.behavior.dedupeTtlSeconds).toBe(3600);
    expect(cfg.llm.model).toBe('test-model');
    expect(cfg.search.indexPattern).toBe('foo-*');
    expect(cfg.logging.level).toBe('debug');
    expect(cfg.logging.includeDebugBodies).toBe(false);
    expect(cfg.logging.redactPaths).toEqual([]);
    expect(cfg.logging.matrixSdkLevel).toBe('WARN');
  });

  it('ignores undocumented threshold env vars', () => {
    const cfg = getConfig({
      ...baseEnv,
      EGRESS_MULTIPLIER: '99',
      EGRESS_MIN_BYTES: '999',
      PORTSCAN_PORTS_THRESHOLD: '999',
      PORTSCAN_MIN_PACKETS: '999',
    });
    expect(cfg.thresholds.egressMultiplier).toBe(3);
    expect(cfg.thresholds.egressMinBytes).toBe(50_000_000);
    expect(cfg.thresholds.portscanDistinctDstPorts).toBe(50);
    expect(cfg.thresholds.portscanMinPackets).toBe(200);
  });

  it('throws a readable error when required vars are missing', () => {
    expect(() => getConfig({})).toThrowError(/Invalid configuration:/);
  });

  it('throws when chat output is forced without any chat adapter configured', () => {
    expect(() =>
      getConfig({
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      }, { outputOverride: 'chat' }),
    ).toThrowError(/Chat mode requires Slack, Matrix, or Mattermost/);
  });

  it('requires all Slack tokens when any Slack env is set in chat output mode', () => {
    expect(() =>
      getConfig({
        SLACK_BOT_TOKEN: 'xoxb-test',
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      }),
    ).toThrowError(/slack\.appToken/);
  });

  it('uses console output without Slack env', () => {
    const cfg = getConfig({
      OPENSEARCH_URL: 'https://opensearch.example.com',
      OPENSEARCH_USERNAME: 'user',
      OPENSEARCH_PASSWORD: 'pass',
      LLM_BASE_URL: 'https://llm.example.com',
      LLM_API_KEY: 'key',
    });

    expect(cfg.output).toBe('console');
    expect(cfg.slack).toBeUndefined();
  });

  it('lets outputOverride force console while ignoring missing Slack', () => {
    const cfg = getConfig(
      {
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      },
      { outputOverride: 'console' },
    );

    expect(cfg.output).toBe('console');
    expect(cfg.slack).toBeUndefined();
  });

  it('lets outputOverride force chat and require at least one adapter', () => {
    expect(() =>
      getConfig(
        {
          OPENSEARCH_URL: 'https://opensearch.example.com',
          OPENSEARCH_USERNAME: 'user',
          OPENSEARCH_PASSWORD: 'pass',
          LLM_BASE_URL: 'https://llm.example.com',
          LLM_API_KEY: 'key',
        },
        { outputOverride: 'chat' },
      ),
    ).toThrowError(/Chat mode requires Slack, Matrix, or Mattermost/);
  });

  it('computes output from configured adapters', () => {
    // output is computed (any chat adapter env => chat, otherwise console)
    const cfg = getConfig({
      OPENSEARCH_URL: baseEnv.OPENSEARCH_URL,
      OPENSEARCH_USERNAME: baseEnv.OPENSEARCH_USERNAME,
      OPENSEARCH_PASSWORD: baseEnv.OPENSEARCH_PASSWORD,
      LLM_BASE_URL: baseEnv.LLM_BASE_URL,
      LLM_API_KEY: baseEnv.LLM_API_KEY,
    });
    expect(cfg.output).toBe('console');
  });

  it('prefers outputOverride over computed output', () => {
    const cfg = getConfig(baseEnv, { outputOverride: 'chat' });
    expect(cfg.output).toBe('chat');
    expect(cfg.slack?.channelId).toBe('C123');
  });

  it('enables chat mode for Matrix-only configurations without Slack env', () => {
    const cfg = getConfig({
      MATRIX_HOMESERVER: 'https://matrix.example.com',
      MATRIX_ACCESS_TOKEN: 'mat-token',
      MATRIX_DEFAULT_ROOM_ID: '!room:example.com',
      OPENSEARCH_URL: 'https://opensearch.example.com',
      OPENSEARCH_USERNAME: 'user',
      OPENSEARCH_PASSWORD: 'pass',
      LLM_BASE_URL: 'https://llm.example.com',
      LLM_API_KEY: 'key',
    });

    expect(cfg.output).toBe('chat');
    expect(cfg.slack).toBeUndefined();
    expect(cfg.matrix?.homeserver).toBe('https://matrix.example.com');
    expect(cfg.matrix?.accessToken).toBe('mat-token');
    expect(cfg.matrix?.defaultRoomId).toBe('!room:example.com');
  });

  it('requires MATRIX_DEFAULT_ROOM_ID when Matrix env is set', () => {
    expect(() =>
      getConfig({
        MATRIX_HOMESERVER: 'https://matrix.example.com',
        MATRIX_ACCESS_TOKEN: 'mat-token',
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      }),
    ).toThrowError(/matrix\.defaultRoomId/);
  });

  it('enables chat mode for Mattermost-only configurations without Slack env', () => {
    const cfg = getConfig({
      MATTERMOST_URL: 'https://chat.example.com',
      MATTERMOST_TOKEN: 'mm-token',
      MATTERMOST_CHANNEL_ID: 'mm-channel',
      OPENSEARCH_URL: 'https://opensearch.example.com',
      OPENSEARCH_USERNAME: 'user',
      OPENSEARCH_PASSWORD: 'pass',
      LLM_BASE_URL: 'https://llm.example.com',
      LLM_API_KEY: 'key',
    });

    expect(cfg.output).toBe('chat');
    expect(cfg.slack).toBeUndefined();
    expect(cfg.mattermost?.url).toBe('https://chat.example.com');
    expect(cfg.mattermost?.channelId).toBe('mm-channel');
  });

  it('allows Matrix + Slack to be configured simultaneously', () => {
    const cfg = getConfig({
      ...baseEnv,
      MATRIX_HOMESERVER: 'https://matrix.example.com',
      MATRIX_ACCESS_TOKEN: 'mat-token',
      MATRIX_DEFAULT_ROOM_ID: '!room:example.com',
    });

    expect(cfg.output).toBe('chat');
    expect(cfg.slack?.botToken).toBe('xoxb-test');
    expect(cfg.matrix?.defaultRoomId).toBe('!room:example.com');
  });

  it('accepts Matrix username + password as an alternative to access token', () => {
    const cfg = getConfig({
      MATRIX_HOMESERVER: 'https://matrix.example.com',
      MATRIX_USER: 'kaytoo',
      MATRIX_PASSWORD: 'pw',
      MATRIX_DEFAULT_ROOM_ID: '!room:example.com',
      OPENSEARCH_URL: 'https://opensearch.example.com',
      OPENSEARCH_USERNAME: 'user',
      OPENSEARCH_PASSWORD: 'pass',
      LLM_BASE_URL: 'https://llm.example.com',
      LLM_API_KEY: 'key',
    });

    expect(cfg.output).toBe('chat');
    expect(cfg.matrix?.user).toBe('kaytoo');
    expect(cfg.matrix?.password).toBe('pw');
    expect(cfg.matrix?.accessToken).toBeUndefined();
  });

  it('rejects Matrix config with neither access token nor user+password', () => {
    expect(() =>
      getConfig({
        MATRIX_HOMESERVER: 'https://matrix.example.com',
        MATRIX_DEFAULT_ROOM_ID: '!room:example.com',
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      }),
    ).toThrowError(/MATRIX_ACCESS_TOKEN or both MATRIX_USER and MATRIX_PASSWORD/);
  });

  it('rejects Matrix config with only a username and no password', () => {
    expect(() =>
      getConfig({
        MATRIX_HOMESERVER: 'https://matrix.example.com',
        MATRIX_USER: 'kaytoo',
        MATRIX_DEFAULT_ROOM_ID: '!room:example.com',
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      }),
    ).toThrowError(/MATRIX_ACCESS_TOKEN or both MATRIX_USER and MATRIX_PASSWORD/);
  });
});

