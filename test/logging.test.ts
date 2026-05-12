import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pino from 'pino';
import { describe, expect, it, beforeEach } from 'vitest';
import { runWithLogContext } from '../src/logging/context.js';
import { getLogger, initLogging, resetLogging } from '../src/logging/logger.js';

describe('logging', () => {
  beforeEach(() => {
    resetLogging();
  });

  function makeSyncFileDest() {
    const dir = mkdtempSync(join(tmpdir(), 'kaytoo-log-'));
    const file = join(dir, 'out.log');
    const dest = pino.destination({ dest: file, sync: true, mkdir: true });
    return {
      dest,
      dir,
      readLines: () =>
        readFileSync(file, 'utf8')
          .trimEnd()
          .split('\n')
          .filter(Boolean),
    };
  }

  it('emits JSON with service and redacts password', () => {
    const { dest, dir, readLines } = makeSyncFileDest();
    initLogging({ level: 'info', redactPaths: [], destination: dest });
    getLogger({ component: 'test' }).info({ password: 'secret', ok: true }, 'hello');
    const lines = readLines();
    rmSync(dir, { recursive: true, force: true });
    expect(lines.length).toBeGreaterThan(0);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.service).toBe('kaytoo');
    expect(row.env).toBe('test');
    expect(row.component).toBe('test');
    expect(row.msg).toBe('hello');
    expect(row.password).toBe('[Redacted]');
    expect(row.ok).toBe(true);
  });

  it('merges AsyncLocalStorage context into records', () => {
    const { dest, dir, readLines } = makeSyncFileDest();
    initLogging({ level: 'info', redactPaths: [], destination: dest });
    runWithLogContext({ pollId: 'pid-1' }, () => {
      getLogger({ component: 'insights' }).info('tick');
    });
    const lines = readLines();
    rmSync(dir, { recursive: true, force: true });
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.pollId).toBe('pid-1');
    expect(row.component).toBe('insights');
  });

  it('supports custom redact paths', () => {
    const { dest, dir, readLines } = makeSyncFileDest();
    initLogging({ level: 'info', redactPaths: ['customSecret'], destination: dest });
    getLogger({ component: 't' }).info({ customSecret: 'hide', x: 1 }, 'm');
    const lines = readLines();
    rmSync(dir, { recursive: true, force: true });
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.customSecret).toBe('[Redacted]');
    expect(row.x).toBe(1);
  });
});
