/** Builds the tool registry and shared OpenSearch client + field mapping context for handlers. */
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
import { chattyWorkloads } from './handlers/chattyWorkloads.js';
import { crossNodeBytesByNode } from './handlers/crossNodeBytesByNode.js';
import { destinationTrafficDropsVsBaseline } from './handlers/destinationTrafficDropsVsBaseline.js';
import { namespaceEdgesByBytes } from './handlers/namespaceEdgesByBytes.js';
import { egressBytesVsBaselineTool } from './handlers/egressBytesVsBaseline.js';
import { egressSpikeDrilldownTool } from './handlers/egressSpikeDrilldown.js';
import { ddosCandidates } from './handlers/ddosCandidates.js';
import { flowAggregateTool } from './handlers/flowAggregate.js';
import { ipVersionProtocolRollup } from './handlers/ipVersionProtocolRollup.js';
import { longLivedFlows } from './handlers/longLivedFlows.js';
import { unexpectedPortsVsBaseline } from './handlers/unexpectedPortsVsBaseline.js';
import { topRfc1918OutsideClusterByBytes } from './handlers/topRfc1918OutsideClusterByBytes.js';
import { namespaceTrafficMatrixTool } from './handlers/namespaceTrafficMatrix.js';
import { portscanCandidatesTool } from './handlers/portscanCandidates.js';
import { protocolNamespaceRollupTool } from './handlers/protocolNamespaceRollup.js';
import { rareExternalDestinations } from './handlers/rareExternalDestinations.js';
import { searchFlows } from './handlers/searchFlows.js';
import { tcpFlagPatternsByWorkload } from './handlers/tcpFlagPatternsByWorkload.js';
import { topConversations5Tuple } from './handlers/topConversations5Tuple.js';
import { topDestinationWorkloadsByBytes } from './handlers/topDestinationWorkloadsByBytes.js';
import { topDstIpPortByDistinctSources } from './handlers/topDstIpPortByDistinctSources.js';
import { topExternalDestinationsByBytes } from './handlers/topExternalDestinationsByBytes.js';
import { topFanOut } from './handlers/topFanOut.js';
import { topPortsByBytesAndFlows } from './handlers/topPortsByBytesAndFlows.js';
import { topDestinationsForSource } from './handlers/topDestinationsForSource.js';
import { topServiceFanIn } from './handlers/topServiceFanIn.js';
import { topServiceFanInVsBaseline } from './handlers/topServiceFanInVsBaseline.js';
import { topSourceWorkloadsByBytesPackets } from './handlers/topSourceWorkloadsByBytesPackets.js';
import { topTalkersByBytes } from './handlers/topTalkersByBytes.js';
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

  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<ToolHandlerResult>>();

  handlers.set('searchFlows', (args) =>
    searchFlows(ctxFields, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topDestinationsForSource', (args) =>
    topDestinationsForSource(ctxFields, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topTalkersByBytes', (args) =>
    topTalkersByBytes(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topServiceFanIn', (args) =>
    topServiceFanIn(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topServiceFanInVsBaseline', (args) =>
    topServiceFanInVsBaseline(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topSourceWorkloadsByBytesPackets', (args) =>
    topSourceWorkloadsByBytesPackets(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topDestinationWorkloadsByBytes', (args) =>
    topDestinationWorkloadsByBytes(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topConversations5Tuple', (args) =>
    topConversations5Tuple(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topFanOut', (args) => topFanOut(ctxPlain, args).then((result) => ({ ok: true as const, result })));
  handlers.set('topDstIpPortByDistinctSources', (args) =>
    topDstIpPortByDistinctSources(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topExternalDestinationsByBytes', (args) =>
    topExternalDestinationsByBytes(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('destinationTrafficDropsVsBaseline', (args) =>
    destinationTrafficDropsVsBaseline(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topRfc1918OutsideClusterByBytes', (args) =>
    topRfc1918OutsideClusterByBytes(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('topPortsByBytesAndFlows', (args) =>
    topPortsByBytesAndFlows(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('ddosCandidates', (args) =>
    ddosCandidates(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('namespaceEdgesByBytes', (args) =>
    namespaceEdgesByBytes(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('unexpectedPortsVsBaseline', (args) =>
    unexpectedPortsVsBaseline(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('longLivedFlows', (args) =>
    longLivedFlows(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('chattyWorkloads', (args) =>
    chattyWorkloads(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('crossNodeBytesByNode', (args) =>
    crossNodeBytesByNode(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('ipVersionProtocolRollup', (args) =>
    ipVersionProtocolRollup(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('tcpFlagPatternsByWorkload', (args) =>
    tcpFlagPatternsByWorkload(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('rareExternalDestinations', (args) =>
    rareExternalDestinations(ctxFields, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('portscanCandidates', (args) =>
    portscanCandidatesTool(
      {
        ...ctxFields,
        thresholds: opts.config.thresholds,
      },
      args,
    ).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('egressBytesVsBaseline', (args) =>
    egressBytesVsBaselineTool(
      {
        ...ctxFields,
        thresholds: opts.config.thresholds,
      },
      args,
    ).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('egressSpikeDrilldown', (args) =>
    egressSpikeDrilldownTool(
      {
        ...ctxFields,
        thresholds: opts.config.thresholds,
      },
      args,
    ).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('namespaceTrafficMatrix', (args) =>
    namespaceTrafficMatrixTool(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('protocolNamespaceRollup', (args) =>
    protocolNamespaceRollupTool(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );
  handlers.set('flowAggregate', (args) =>
    flowAggregateTool(ctxPlain, args).then((result) => ({ ok: true as const, result })),
  );

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
