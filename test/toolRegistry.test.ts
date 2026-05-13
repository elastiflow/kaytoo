import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAgentPolicy } from '../src/agent/policy.js';
import { getConfig } from '../src/config.js';

const handler = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));

vi.mock('../src/opensearch/waitForFieldMapping.js', () => ({
  waitForOpenSearchFieldMapping: vi.fn().mockResolvedValue({
    bytesField: 'flow.bytes',
    srcIpField: 'flow.client.ip.addr',
    dstIpField: 'flow.server.ip.addr',
    srcPortField: 'flow.client.port',
    dstPortField: 'flow.server.port',
    protoField: 'l4.proto.name',
  }),
}));
vi.mock('../src/search/client.js', () => ({
  createSearchClient: vi.fn(() => ({ search: vi.fn(), fieldCaps: vi.fn() })),
}));
vi.mock('../src/opensearch/mcpClient.js', () => ({
  probeOpenSearchMcpServer: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../src/knowledge/kbSearch.js', () => ({
  isKbDirUsable: vi.fn().mockResolvedValue(false),
  searchKnowledgeBase: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/agent/mcpJsonRpc.js', () => ({
  mcpJsonRpcCall: vi.fn().mockResolvedValue({ ok: true, result: { x: 1 } }),
}));

vi.mock('../src/agent/tools/handlers/chattyWorkloads.js', () => ({ chattyWorkloads: handler }));
vi.mock('../src/agent/tools/handlers/crossNodeBytesByNode.js', () => ({ crossNodeBytesByNode: handler }));
vi.mock('../src/agent/tools/handlers/destinationTrafficDropsVsBaseline.js', () => ({
  destinationTrafficDropsVsBaseline: handler,
}));
vi.mock('../src/agent/tools/handlers/namespaceEdgesByBytes.js', () => ({ namespaceEdgesByBytes: handler }));
vi.mock('../src/agent/tools/handlers/egressBytesVsBaseline.js', () => ({ egressBytesVsBaselineTool: handler }));
vi.mock('../src/agent/tools/handlers/egressSpikeDrilldown.js', () => ({ egressSpikeDrilldownTool: handler }));
vi.mock('../src/agent/tools/handlers/ddosCandidates.js', () => ({ ddosCandidates: handler }));
vi.mock('../src/agent/tools/handlers/flowAggregate.js', () => ({ flowAggregateTool: handler }));
vi.mock('../src/agent/tools/handlers/ipVersionProtocolRollup.js', () => ({ ipVersionProtocolRollup: handler }));
vi.mock('../src/agent/tools/handlers/longLivedFlows.js', () => ({ longLivedFlows: handler }));
vi.mock('../src/agent/tools/handlers/unexpectedPortsVsBaseline.js', () => ({ unexpectedPortsVsBaseline: handler }));
vi.mock('../src/agent/tools/handlers/topRfc1918OutsideClusterByBytes.js', () => ({
  topRfc1918OutsideClusterByBytes: handler,
}));
vi.mock('../src/agent/tools/handlers/namespaceTrafficMatrix.js', () => ({ namespaceTrafficMatrixTool: handler }));
vi.mock('../src/agent/tools/handlers/portscanCandidates.js', () => ({ portscanCandidatesTool: handler }));
vi.mock('../src/agent/tools/handlers/protocolNamespaceRollup.js', () => ({ protocolNamespaceRollupTool: handler }));
vi.mock('../src/agent/tools/handlers/rareExternalDestinations.js', () => ({ rareExternalDestinations: handler }));
vi.mock('../src/agent/tools/handlers/searchFlows.js', () => ({ searchFlows: handler }));
vi.mock('../src/agent/tools/handlers/tcpFlagPatternsByWorkload.js', () => ({ tcpFlagPatternsByWorkload: handler }));
vi.mock('../src/agent/tools/handlers/topConversations5Tuple.js', () => ({ topConversations5Tuple: handler }));
vi.mock('../src/agent/tools/handlers/topDestinationWorkloadsByBytes.js', () => ({
  topDestinationWorkloadsByBytes: handler,
}));
vi.mock('../src/agent/tools/handlers/topDstIpPortByDistinctSources.js', () => ({
  topDstIpPortByDistinctSources: handler,
}));
vi.mock('../src/agent/tools/handlers/topExternalDestinationsByBytes.js', () => ({
  topExternalDestinationsByBytes: handler,
}));
vi.mock('../src/agent/tools/handlers/topFanOut.js', () => ({ topFanOut: handler }));
vi.mock('../src/agent/tools/handlers/topPortsByBytesAndFlows.js', () => ({ topPortsByBytesAndFlows: handler }));
vi.mock('../src/agent/tools/handlers/topDestinationsForSource.js', () => ({ topDestinationsForSource: handler }));
vi.mock('../src/agent/tools/handlers/topServiceFanIn.js', () => ({ topServiceFanIn: handler }));
vi.mock('../src/agent/tools/handlers/topServiceFanInVsBaseline.js', () => ({ topServiceFanInVsBaseline: handler }));
vi.mock('../src/agent/tools/handlers/topSourceWorkloadsByBytesPackets.js', () => ({
  topSourceWorkloadsByBytesPackets: handler,
}));
vi.mock('../src/agent/tools/handlers/topTalkersByBytes.js', () => ({ topTalkersByBytes: handler }));

import * as kb from '../src/knowledge/kbSearch.js';
import * as mcp from '../src/agent/mcpJsonRpc.js';
import * as probe from '../src/opensearch/mcpClient.js';
import { createToolRegistry } from '../src/agent/tools/registry.js';
import { coreToolSpecs } from '../src/agent/tools/toolSpecs.js';

function baseEnv(extra: Record<string, string> = {}) {
  return {
    OPENSEARCH_URL: 'https://os.test',
    OPENSEARCH_USERNAME: 'u',
    OPENSEARCH_PASSWORD: 'p',
    LLM_BASE_URL: 'https://llm.test',
    LLM_API_KEY: 'k',
    ...extra,
  };
}

describe('createToolRegistry', () => {
  beforeEach(() => {
    vi.mocked(handler).mockClear();
    vi.mocked(probe.probeOpenSearchMcpServer).mockResolvedValue({ ok: true });
    vi.mocked(kb.isKbDirUsable).mockResolvedValue(false);
    vi.mocked(mcp.mcpJsonRpcCall).mockResolvedValue({ ok: true, result: { x: 1 } });
  });

  it('listTools and call dispatch a stubbed handler', async () => {
    const reg = await createToolRegistry({
      config: getConfig(baseEnv({ KAYTOO_AGENT_TOOL_ALLOWLIST: 'searchFlows' })),
      policy: defaultAgentPolicy,
    });
    expect(reg.listTools().map((t) => t.name)).toEqual(['searchFlows']);
    const out = await reg.call({
      name: 'searchFlows',
      args: { index: 'elastiflow-flow-codex-*', query: { match_all: {} }, minutesBack: 5, size: 1 },
    });
    expect(out.ok).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('rejects unknown tools and allowlisted-only tools', async () => {
    const reg = await createToolRegistry({
      config: getConfig(baseEnv({ KAYTOO_AGENT_TOOL_ALLOWLIST: 'searchFlows' })),
      policy: defaultAgentPolicy,
    });
    expect((await reg.call({ name: 'topTalkersByBytes', args: {} })).ok).toBe(false);
    expect((await reg.call({ name: 'nope', args: {} })).ok).toBe(false);
  });

  it('kbSearch when KB not ready', async () => {
    const reg = await createToolRegistry({ config: getConfig(baseEnv()), policy: defaultAgentPolicy });
    const out = await reg.call({ name: 'kbSearch', args: { query: 'x' } });
    expect(out.ok).toBe(false);
    expect(String((out as { result: { error: string } }).result.error)).toMatch(/not configured/i);
  });

  it('kbSearch delegates when KB is usable', async () => {
    vi.mocked(kb.isKbDirUsable).mockResolvedValue(true);
    vi.mocked(kb.searchKnowledgeBase).mockResolvedValue([{ id: 'a', path: 'p', snippet: 's', score: 1 }]);
    const reg = await createToolRegistry({
      config: getConfig(baseEnv({ KAYTOO_KB_DOCS_DIR: '/kb', KAYTOO_AGENT_TOOL_ALLOWLIST: 'kbSearch' })),
      policy: defaultAgentPolicy,
    });
    const out = await reg.call({ name: 'kbSearch', args: { query: 'q' } });
    expect(out.ok).toBe(true);
  });

  it('mcpToolCall without URL and with RPC', async () => {
    let reg = await createToolRegistry({ config: getConfig(baseEnv()), policy: defaultAgentPolicy });
    expect((await reg.call({ name: 'mcpToolCall', args: { toolName: 't', arguments: {} } })).ok).toBe(false);

    reg = await createToolRegistry({
      config: getConfig(
        baseEnv({
          KAYTOO_MCP_JSONRPC_URL: 'https://mcp/rpc',
          KAYTOO_MCP_JSONRPC_BEARER: 'tok',
          KAYTOO_AGENT_TOOL_ALLOWLIST: 'mcpToolCall',
        }),
      ),
      policy: defaultAgentPolicy,
    });
    const ok = await reg.call({ name: 'mcpToolCall', args: { toolName: 't', arguments: { a: 1 } } });
    expect(ok.ok).toBe(true);
    expect(mcp.mcpJsonRpcCall).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp/rpc', bearer: 'tok', method: 'tools/call' }),
    );

    vi.mocked(mcp.mcpJsonRpcCall).mockClear();
    const regNoBearer = await createToolRegistry({
      config: getConfig(
        baseEnv({ KAYTOO_MCP_JSONRPC_URL: 'https://mcp/rpc', KAYTOO_AGENT_TOOL_ALLOWLIST: 'mcpToolCall' }),
      ),
      policy: defaultAgentPolicy,
    });
    await regNoBearer.call({ name: 'mcpToolCall', args: { toolName: 't', arguments: 'bad' } });
    expect(mcp.mcpJsonRpcCall).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp/rpc', method: 'tools/call' }),
    );
    const lastCall = vi.mocked(mcp.mcpJsonRpcCall).mock.calls.at(-1)![0] as { bearer?: string };
    expect(lastCall.bearer).toBeUndefined();

    vi.mocked(mcp.mcpJsonRpcCall).mockResolvedValueOnce({ ok: false, error: 'rpc err' });
    const bad = await regNoBearer.call({ name: 'mcpToolCall', args: { toolName: 't' } });
    expect(bad.ok).toBe(false);
  });

  it('mcpToolCall rejects empty toolName', async () => {
    const reg = await createToolRegistry({
      config: getConfig(
        baseEnv({ KAYTOO_MCP_JSONRPC_URL: 'https://mcp/rpc', KAYTOO_AGENT_TOOL_ALLOWLIST: 'mcpToolCall' }),
      ),
      policy: defaultAgentPolicy,
    });
    const out = await reg.call({ name: 'mcpToolCall', args: { toolName: '', arguments: {} } });
    expect(out.ok).toBe(false);
  });

  it('probe warns when MCP URL set but probe fails', async () => {
    vi.mocked(probe.probeOpenSearchMcpServer).mockResolvedValue({ ok: false, warning: 'down' });
    await createToolRegistry({
      config: getConfig(baseEnv({ OPENSEARCH_MCP_URL: 'https://mcp/stream' })),
      policy: defaultAgentPolicy,
    });
    expect(probe.probeOpenSearchMcpServer).toHaveBeenCalled();
  });

  it('probe info path when MCP reachable', async () => {
    vi.mocked(probe.probeOpenSearchMcpServer).mockResolvedValue({ ok: true });
    await createToolRegistry({
      config: getConfig(baseEnv({ OPENSEARCH_MCP_URL: 'https://mcp/stream' })),
      policy: defaultAgentPolicy,
    });
    expect(probe.probeOpenSearchMcpServer).toHaveBeenCalled();
  });

  it('kb dir set but unusable still builds registry', async () => {
    vi.mocked(kb.isKbDirUsable).mockResolvedValue(false);
    await createToolRegistry({
      config: getConfig(baseEnv({ KAYTOO_KB_DOCS_DIR: '/missing-kb' })),
      policy: defaultAgentPolicy,
    });
  });

  it('dispatches each exposed tool (registry wiring)', async () => {
    const reg = await createToolRegistry({ config: getConfig(baseEnv()), policy: defaultAgentPolicy });
    for (const t of reg.listTools()) {
      const out = await reg.call({ name: t.name, args: {} });
      expect(out.name).toBe(t.name);
    }
    expect(handler.mock.calls.length).toBeGreaterThan(15);
  });

  it('listTools includes every coreToolSpec when allowlist is empty', async () => {
    const reg = await createToolRegistry({ config: getConfig(baseEnv()), policy: defaultAgentPolicy });
    const listed = reg.listTools().map((t) => t.name);
    expect(listed.length).toBe(coreToolSpecs.length);
    for (const { name } of coreToolSpecs) {
      expect(listed).toContain(name);
    }
  });

  it('call coerces non-object args to {}', async () => {
    const reg = await createToolRegistry({
      config: getConfig(baseEnv({ KAYTOO_AGENT_TOOL_ALLOWLIST: 'searchFlows' })),
      policy: defaultAgentPolicy,
    });
    await reg.call({ name: 'searchFlows', args: null as never });
    expect(handler).toHaveBeenCalled();
  });

  it('call wraps handler errors', async () => {
    vi.mocked(handler).mockRejectedValueOnce(new Error('handler boom'));
    const reg = await createToolRegistry({
      config: getConfig(baseEnv({ KAYTOO_AGENT_TOOL_ALLOWLIST: 'searchFlows' })),
      policy: defaultAgentPolicy,
    });
    const out = await reg.call({
      name: 'searchFlows',
      args: { index: 'elastiflow-flow-codex-*', query: { match_all: {} }, minutesBack: 1, size: 1 },
    });
    expect(out.ok).toBe(false);
    expect((out as { result: { error: string } }).result.error).toMatch(/handler boom/);
  });
});
