import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';
import { getLogContext } from './context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultRedactPaths = [
  'password',
  '*.token',
  '*.accessToken',
  '*.password',
  '*.apiKey',
  '*.authorization',
  'authorization',
  'req.headers.authorization',
  'headers.authorization',
];

const root: { current: PinoLogger | null } = { current: null };

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '../../package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return 'unknown';
  }
}

export type LoggingInit = {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  redactPaths: string[];
  destination?: DestinationStream;
};

export function initLogging(opts: LoggingInit): PinoLogger {
  const redact = [...defaultRedactPaths, ...opts.redactPaths];
  const baseOpts = {
    level: opts.level,
    base: {
      service: 'kaytoo',
      env: process.env.NODE_ENV ?? 'development',
      version: readPackageVersion(),
    },
    redact: { paths: redact, censor: '[Redacted]' },
    mixin() {
      return getLogContext() ?? {};
    },
  };
  root.current = opts.destination ? pino(baseOpts, opts.destination) : pino(baseOpts);
  return root.current;
}

export function resetLogging(): void {
  root.current = null;
}

export function getRootLogger(): PinoLogger {
  if (!root.current) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST != null;
    root.current = initLogging({
      level: isTest ? 'silent' : 'info',
      redactPaths: [],
    });
  }
  return root.current;
}

export type LoggerBindings = { component: string } & Record<string, unknown>;

export function getLogger(bindings: LoggerBindings): PinoLogger {
  return getRootLogger().child(bindings);
}

export function logErr(e: unknown): { err: { name: string; message: string; stack?: string } } {
  if (e instanceof Error) {
    return {
      err: {
        name: e.name,
        message: e.message,
        ...(e.stack ? { stack: e.stack } : {}),
      },
    };
  }
  const message =
    typeof e === 'string'
      ? e
      : typeof e === 'number' || typeof e === 'boolean'
        ? String(e)
        : (() => {
            try {
              return JSON.stringify(e);
            } catch {
              return String(e);
            }
          })();
  return { err: { name: 'Error', message } };
}

export async function withDurationMs<T>(log: PinoLogger, msg: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    log.debug({ durationMs: Date.now() - t0 }, msg);
    return out;
  } catch (e) {
    log.warn(
      {
        durationMs: Date.now() - t0,
        ...(e instanceof Error ? { err: e } : logErr(e)),
      },
      `${msg} failed`,
    );
    throw e;
  }
}
