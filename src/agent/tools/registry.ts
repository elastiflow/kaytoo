import type { KaytooConfig } from '../../config.js';
import { getLogger } from '../../logging/logger.js';
import { probeOpenSearchMcpServer } from '../../opensearch/mcpClient.js';
import { waitForOpenSearchFieldMapping } from '../../opensearch/waitForFieldMapping.js';
import { createSearchClient } from '../../search/client.js';
import { searchKnowledgeBase, isKbDirUsable } from '../../knowledge/kbSearch.js';
import { mcpJsonRpcCall } from '../mcpJsonRpc.js';
import { thrownMessage } from '../../util/guards.js';
import { isAgentToolAllowed, type AgentPolicy } from '../policy.js';
import { buildToolDefinitionList } from './definitions.js';
import { coreToolSpecs } from './toolSpecs.js';
import { isRecordArgs } from './helpers.js';
import type { ToolCall, ToolRegistry, ToolResult } from './types.js';

type ToolHandlerResult = { ok: true; result: unknown } | { ok: false; result: { error: string } };

export async function createToolRegistry(opts: {
  config: KaytooConfig;
  policy: AgentPolicy;
}): Promise<ToolRegistry> {
  const log = getLogger({ component: 'agent.tools' });
  const client = await createSearchClient(opts.config.search);
  const fields = await waitForOpenSearchFieldMapping({
    client,
    indexPattern: opts.config.search.indexPattern,
    log,
  });

  if (opts.config.search.mcpUrl) {
    const probe = await probeOpenSearchMcpServer({ url: opts.config.search.mcpUrl });
    if (!probe.ok) {
      log.warn({ mcpWarning: probe.warning ?? 'unknown error' }, 'MCP unavailable');
    } else {
      log.info('MCP URL reachable (probe only; queries still use OpenSearch client)');
    }
  }

  const allow = opts.config.agent.toolAllowlist;
  const kbDir = opts.config.knowledge.docsDir;
  const kbReady = kbDir ? await isKbDirUsable(kbDir) : false;
  if (kbDir && !kbReady) log.warn({ kbDir }, 'KAYTOO_KB_DOCS_DIR is not a readable directory; kbSearch disabled');

  const allTools = buildToolDefinitionList({
    kbDir,
    kbReady,
    mcpJsonRpcUrl: opts.config.agent.mcpJsonRpcUrl,
  });

  const exposed = allTools.filter((t) => isAgentToolAllowed(t.name, allow));

  const defaultIndex = opts.config.search.indexPattern;
  const ctxPlain = { client, policy: opts.policy, defaultIndex };
  const ctxFields = { ...ctxPlain, fields };
  const ctxBundle = {
    ctxPlain,
    ctxFields,
    ctxThresholds: { ...ctxFields, thresholds: opts.config.thresholds },
  };

  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<ToolHandlerResult>>();

  for (const spec of coreToolSpecs) {
    const run = spec.bind(ctxBundle);
    handlers.set(spec.name, (args) => run(args).then((result) => ({ ok: true as const, result })));
  }

  handlers.set('kbSearch', async (args) => {
    if (!kbDir || !kbReady) return { ok: false as const, result: { error: 'kbSearch not configured' } };
    const query = typeof args.query === 'string' ? args.query : '';
    const topK = typeof args.topK === 'number' ? args.topK : 5;
    const hits = await searchKnowledgeBase({
      docsDir: kbDir,
      query,
      topK,
      maxSnippetChars: opts.config.knowledge.maxSnippetChars,
    });
    return { ok: true as const, result: { hits } };
  });

  handlers.set('mcpToolCall', async (args) => {
    const url = opts.config.agent.mcpJsonRpcUrl;
    if (!url) return { ok: false as const, result: { error: 'MCP JSON-RPC URL not configured' } };
    const toolName = typeof args.toolName === 'string' ? args.toolName : '';
    if (!toolName) return { ok: false as const, result: { error: 'toolName required' } };
    const argsObj = args.arguments;
    const rpc = await mcpJsonRpcCall({
      url,
      ...(opts.config.agent.mcpJsonRpcBearer ? { bearer: opts.config.agent.mcpJsonRpcBearer } : {}),
      method: 'tools/call',
      params: { name: toolName, arguments: isRecordArgs(argsObj) ? argsObj : {} },
    });
    if (!rpc.ok) return { ok: false as const, result: { error: rpc.error } };
    return { ok: true as const, result: rpc.result };
  });

  return {
    listTools() {
      return exposed;
    },

    async call(tool: ToolCall): Promise<ToolResult> {
      if (!isAgentToolAllowed(tool.name, allow)) {
        return { name: tool.name, ok: false, result: { error: 'tool not allowed by KAYTOO_AGENT_TOOL_ALLOWLIST' } };
      }
      const run = handlers.get(tool.name);
      if (!run) {
        return { name: tool.name, ok: false, result: { error: 'unknown tool' } };
      }
      try {
        const args = isRecordArgs(tool.args) ? tool.args : {};
        const out = await run(args);
        return { name: tool.name, ...out };
      } catch (e) {
        return { name: tool.name, ok: false, result: { error: thrownMessage(e) } };
      }
    },
  };
}
