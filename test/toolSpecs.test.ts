import { describe, expect, it } from 'vitest';
import { buildToolDefinitionList } from '../src/agent/tools/definitions.js';
import { coreToolDefinitions, coreToolSpecs } from '../src/agent/tools/toolSpecs.js';

describe('coreToolSpecs', () => {
  it('has unique tool names', () => {
    const names = coreToolSpecs.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('matches buildToolDefinitionList when kb and mcp are off', () => {
    expect(
      buildToolDefinitionList({ kbDir: undefined, kbReady: false, mcpJsonRpcUrl: undefined }),
    ).toEqual(coreToolDefinitions);
  });

  it('prepends the same core defs when kb or mcp are enabled', () => {
    const core = coreToolDefinitions;
    const withKb = buildToolDefinitionList({ kbDir: '/kb', kbReady: true, mcpJsonRpcUrl: undefined });
    expect(withKb.slice(0, core.length)).toEqual(core);
    expect(withKb.some((t) => t.name === 'kbSearch')).toBe(true);

    const withMcp = buildToolDefinitionList({ kbDir: undefined, kbReady: false, mcpJsonRpcUrl: 'http://h' });
    expect(withMcp.slice(0, core.length)).toEqual(core);
    expect(withMcp.some((t) => t.name === 'mcpToolCall')).toBe(true);
  });
});
