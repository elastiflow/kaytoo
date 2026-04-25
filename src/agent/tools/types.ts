export type ToolCall = { name: string; args: Record<string, unknown> };
export type ToolResult = { name: string; ok: boolean; result: unknown };

export type ToolRegistry = {
  listTools(): Array<{ name: string; description: string; argsSchema: unknown }>;
  call(tool: ToolCall): Promise<ToolResult>;
};

export type ToolDef = { name: string; description: string; argsSchema: unknown };
