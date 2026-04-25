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
    expect(cfg.logging.nodeEnv).toBe('development');
    expect(cfg.conversation.ttlSeconds).toBe(604_800);
    expect(cfg.conversation.maxTurns).toBe(20);
    expect(cfg.conversation.summarizeAfterTurns).toBe(12);
    expect(cfg.conversation.storePath).toBeUndefined();
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
    expect(cfg.logging.nodeEnv).toBe('development');
  });

  it('ignores NODE_ENV and threshold env vars', () => {
    const cfg = getConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      EGRESS_MULTIPLIER: '99',
      EGRESS_MIN_BYTES: '999',
      PORTSCAN_PORTS_THRESHOLD: '999',
      PORTSCAN_MIN_PACKETS: '999',
    });
    expect(cfg.logging.nodeEnv).toBe('development');
    expect(cfg.thresholds.egressMultiplier).toBe(3);
    expect(cfg.thresholds.egressMinBytes).toBe(50_000_000);
    expect(cfg.thresholds.portscanDistinctDstPorts).toBe(50);
    expect(cfg.thresholds.portscanMinPackets).toBe(200);
  });

  it('throws a readable error when required vars are missing', () => {
    expect(() => getConfig({})).toThrowError(/Invalid configuration:/);
  });

  it('throws when slack creds are missing in chat output mode', () => {
    expect(() =>
      getConfig({
        OPENSEARCH_URL: 'https://opensearch.example.com',
        OPENSEARCH_USERNAME: 'user',
        OPENSEARCH_PASSWORD: 'pass',
        LLM_BASE_URL: 'https://llm.example.com',
        LLM_API_KEY: 'key',
      }, { outputOverride: 'chat' }),
    ).toThrowError(/slack\.botToken/);
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

  it('lets outputOverride force chat and require Slack creds', () => {
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
    ).toThrowError(/slack\.botToken/);
  });

  it('computes output from configured adapters', () => {
    // output is computed (Slack configured => chat, otherwise console)
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
});

