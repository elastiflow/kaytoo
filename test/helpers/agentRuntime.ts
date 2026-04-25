import { vi } from 'vitest';
import { useSilentLogging } from './logging.js';

/** Silent logging plus `fetch` stub / mock cleanup for agent integration tests. */
export function useAgentRuntimeTestHooks(
  beforeEach: (fn: () => void) => void,
  afterEach: (fn: () => void) => void,
): void {
  useSilentLogging(beforeEach, afterEach);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
}
