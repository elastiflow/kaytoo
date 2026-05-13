import { coreToolDefinitions } from './toolSpecs.js';
import type { ToolDef } from './types.js';

export function buildToolDefinitionList(opts: {
  kbDir: string | undefined;
  kbReady: boolean;
  mcpJsonRpcUrl: string | undefined;
}): ToolDef[] {
  return [
    ...coreToolDefinitions,
    ...(opts.kbDir && opts.kbReady
      ? [
          {
            name: 'kbSearch',
            description:
              'Search local knowledge base (markdown/text under KAYTOO_KB_DOCS_DIR). Returns snippets with source paths for citations.',
            argsSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                topK: { type: 'number' },
              },
              required: ['query'],
            },
          },
        ]
      : []),
    ...(opts.mcpJsonRpcUrl
      ? [
          {
            name: 'mcpToolCall',
            description:
              'Call a remote tool via JSON-RPC 2.0 at KAYTOO_MCP_JSONRPC_URL (MCP-style bridge). Params: toolName, arguments object.',
            argsSchema: {
              type: 'object',
              properties: {
                toolName: { type: 'string' },
                arguments: { type: 'object' },
              },
              required: ['toolName'],
            },
          },
        ]
      : []),
  ];
}
