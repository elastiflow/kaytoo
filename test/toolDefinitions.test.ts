import { describe, expect, it } from 'vitest';
import { buildToolDefinitionList } from '../src/agent/tools/definitions.js';

describe('buildToolDefinitionList', () => {
  it('conditional kbSearch and mcpToolCall', () => {
    const names = (o: Parameters<typeof buildToolDefinitionList>[0]) =>
      buildToolDefinitionList(o).map((t) => t.name);
    expect(names({ kbDir: undefined, kbReady: false, mcpJsonRpcUrl: undefined })).not.toContain('kbSearch');
    expect(names({ kbDir: '/kb', kbReady: false, mcpJsonRpcUrl: undefined })).not.toContain('kbSearch');
    expect(names({ kbDir: '/kb', kbReady: true, mcpJsonRpcUrl: undefined })).toContain('kbSearch');
    expect(names({ kbDir: undefined, kbReady: false, mcpJsonRpcUrl: undefined })).not.toContain('mcpToolCall');
    expect(names({ kbDir: undefined, kbReady: false, mcpJsonRpcUrl: 'http://h' })).toContain('mcpToolCall');
  });

  it('core tools present', () => {
    const n = buildToolDefinitionList({ kbDir: undefined, kbReady: false, mcpJsonRpcUrl: undefined }).map(
      (t) => t.name,
    );
    expect(n).toContain('searchFlows');
    expect(n).toContain('flowAggregate');
  });
});
