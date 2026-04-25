import { describe, expect, it } from 'vitest';
import { isAgentToolAllowed } from '../src/agent/policy.js';

describe('isAgentToolAllowed', () => {
  it('allows all when allowlist empty', () => {
    expect(isAgentToolAllowed('kbSearch', [])).toBe(true);
  });

  it('restricts to allowlist when set', () => {
    expect(isAgentToolAllowed('kbSearch', ['searchFlows'])).toBe(false);
    expect(isAgentToolAllowed('searchFlows', ['searchFlows'])).toBe(true);
  });
});
