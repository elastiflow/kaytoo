import type { Logger } from 'matrix-js-sdk/lib/logger.js';
import type { Logger as PinoLogger } from 'pino';
import { getLogger } from './logger.js';

export type MatrixSdkLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const levelRank: Record<MatrixSdkLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return '[object]';
        }
      }
      return String(a);
    })
    .join(' ');
}

/** Bridges matrix-js-sdk `Logger` to Kaytoo's pino JSON logs. */
export function createMatrixJsSdkLogger(matrixSdkLevel: MatrixSdkLevel): Logger {
  const minRank = levelRank[matrixSdkLevel];
  const base = getLogger({ component: 'matrix.sdk' });
  const should = (rank: number): boolean => rank >= minRank;

  class PinoMatrixLogger implements Logger {
    constructor(private readonly pino: PinoLogger) {}

    trace(...msg: unknown[]): void {
      if (!should(levelRank.TRACE)) return;
      this.pino.trace({ matrixMsg: formatArgs(msg) }, 'matrix-js-sdk');
    }

    debug(...msg: unknown[]): void {
      if (!should(levelRank.DEBUG)) return;
      this.pino.debug({ matrixMsg: formatArgs(msg) }, 'matrix-js-sdk');
    }

    info(...msg: unknown[]): void {
      if (!should(levelRank.INFO)) return;
      this.pino.info({ matrixMsg: formatArgs(msg) }, 'matrix-js-sdk');
    }

    warn(...msg: unknown[]): void {
      if (!should(levelRank.WARN)) return;
      this.pino.warn({ matrixMsg: formatArgs(msg) }, 'matrix-js-sdk');
    }

    error(...msg: unknown[]): void {
      if (!should(levelRank.ERROR)) return;
      this.pino.error({ matrixMsg: formatArgs(msg) }, 'matrix-js-sdk');
    }

    /** @deprecated matrix-js-sdk compatibility */
    log(...msg: unknown[]): void {
      this.debug(...msg);
    }

    getChild(namespace: string): Logger {
      return new PinoMatrixLogger(this.pino.child({ matrixNamespace: namespace }));
    }
  }

  return new PinoMatrixLogger(base);
}
