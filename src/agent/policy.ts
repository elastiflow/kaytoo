export type AgentPolicy = {
  allowedIndexPatterns: string[];
  maxLookbackDays: number;
  maxBucketSize: number;
  maxHits: number;
  maxAggDepth: number;
  maxAggsNodes: number;
  aggregateRequestTimeoutMs: number;
};

export const defaultAgentPolicy: AgentPolicy = {
  allowedIndexPatterns: ['elastiflow-flow-codex-*', 'elastiflow-flow-*'],
  maxLookbackDays: 7,
  maxBucketSize: 200,
  maxHits: 20,
  maxAggDepth: 4,
  maxAggsNodes: 28,
  aggregateRequestTimeoutMs: 25_000,
};

export function assertIndexAllowed(index: string, policy: AgentPolicy): void {
  // Simple allowlist: exact match or wildcard prefix/suffix.
  const ok = policy.allowedIndexPatterns.some((p) => {
    if (p === index) return true;
    if (!p.includes('*')) return false;
    const [pre, post] = p.split('*');
    return (pre ? index.startsWith(pre) : true) && (post ? index.endsWith(post) : true);
  });
  if (!ok) throw new Error(`Index not allowed by policy: ${index}`);
}

export function clampBucketSize(size: number, policy: AgentPolicy): number {
  if (!Number.isFinite(size) || size <= 0) return Math.min(10, policy.maxBucketSize);
  return Math.min(Math.floor(size), policy.maxBucketSize);
}

export function clampHits(size: number, policy: AgentPolicy): number {
  if (!Number.isFinite(size) || size <= 0) return Math.min(10, policy.maxHits);
  return Math.min(Math.floor(size), policy.maxHits);
}

/** When allowlist is empty, all registered tools are allowed. */
export function isAgentToolAllowed(name: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  return allowlist.includes(name);
}

