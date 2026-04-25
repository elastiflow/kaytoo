import pino from 'pino';
import { initLogging, resetLogging } from '../../src/logging/logger.js';

/** Pino silent + reset between tests (Vitest hooks). */
export function useSilentLogging(
  beforeEach: (fn: () => void) => void,
  afterEach: (fn: () => void) => void,
): void {
  beforeEach(() => {
    resetLogging();
    initLogging({
      level: 'silent',
      redactPaths: [],
      nodeEnv: 'test',
      destination: pino.destination('/dev/null'),
    });
  });
  afterEach(() => {
    resetLogging();
  });
}
