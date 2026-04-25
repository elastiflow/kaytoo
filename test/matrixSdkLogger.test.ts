import { beforeEach, describe, expect, it, vi } from 'vitest';

const trace = vi.fn();
const debug = vi.fn();
const info = vi.fn();
const warn = vi.fn();
const error = vi.fn();
const makePino = () => ({ trace, debug, info, warn, error, child: vi.fn(() => makePino()) });

vi.mock('../src/logging/logger.js', () => ({ getLogger: vi.fn(() => makePino()) }));

import { createMatrixJsSdkLogger } from '../src/logging/matrixSdkLogger.js';

describe('createMatrixJsSdkLogger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('level gating', () => {
    createMatrixJsSdkLogger('ERROR').trace('a');
    expect(trace).not.toHaveBeenCalled();
    createMatrixJsSdkLogger('ERROR').error('e');
    expect(error).toHaveBeenCalledWith({ matrixMsg: 'e' }, 'matrix-js-sdk');
    createMatrixJsSdkLogger('TRACE').trace('t');
    expect(trace).toHaveBeenCalledWith({ matrixMsg: 't' }, 'matrix-js-sdk');
  });

  it('deprecated log -> debug', () => {
    const log = createMatrixJsSdkLogger('DEBUG');
    (log as unknown as { log: (...a: unknown[]) => void }).log('x');
    expect(debug).toHaveBeenCalledWith({ matrixMsg: 'x' }, 'matrix-js-sdk');
  });

  it('formatArgs and getChild', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    createMatrixJsSdkLogger('INFO').info(new Error('boom'), circular);
    expect(info).toHaveBeenCalledWith(
      { matrixMsg: expect.stringMatching(/boom.*\[object\]/) },
      'matrix-js-sdk',
    );
    const child = createMatrixJsSdkLogger('WARN').getChild('ns');
    child.debug('n');
    expect(debug).not.toHaveBeenCalled();
    child.warn('y');
    expect(warn).toHaveBeenCalled();
  });
});
