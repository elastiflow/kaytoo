import pino from 'pino';
import { initLogging, resetLogging } from '../../src/logging/logger.js';
import { resetChatUrlCacheForTests } from '../../src/llm/openaiCompat.js';
import { resetJsonParseWarnThrottlesForTests } from '../../src/util/json.js';

/** Pino silent + reset between tests (Vitest hooks). */
export function useSilentLogging(
  beforeEach: (fn: () => void) => void,
  afterEach: (fn: () => void) => void,
): void {
  beforeEach(() => {
    resetLogging();
    resetChatUrlCacheForTests();
    resetJsonParseWarnThrottlesForTests();
    initLogging({
      level: 'silent',
      redactPaths: [],
      destination: pino.destination('/dev/null'),
    });
  });
  afterEach(() => {
    resetLogging();
    resetChatUrlCacheForTests();
    resetJsonParseWarnThrottlesForTests();
  });
}
