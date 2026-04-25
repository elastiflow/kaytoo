import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  extractFirstJsonSubstring,
  parseJsonOrNull,
  parseJsonOrThrow,
  parseLenientTopLevelJson,
  stripMarkdownCodeFences,
} from '../src/util/json.js';

describe('json util', () => {
  it('parseJsonOrThrow / parseJsonOrNull', () => {
    expect(parseJsonOrNull({ raw: '[1]', context: 'c' })).toEqual([1]);
    expect(parseJsonOrNull({ raw: '{', context: 'no-log' })).toBeNull();
    expect(parseJsonOrThrow({ raw: '{"a":1}', context: 'c' })).toEqual({ a: 1 });
    expect(() => parseJsonOrThrow({ raw: '{', context: 'ctx' })).toThrow(/ctx: invalid JSON/);
  });

  it('parseJsonOrNull warn rate limit', () => {
    const warn = vi.fn();
    const log = { warn } as unknown as Logger;
    parseJsonOrNull({ raw: '{', context: 'x', log, warnEveryMs: 60_000 });
    parseJsonOrNull({ raw: '{', context: 'x', log, warnEveryMs: 60_000 });
    expect(warn).toHaveBeenCalledTimes(1);
    (log as Logger & { __kaytooNextJsonWarnAtMs?: number }).__kaytooNextJsonWarnAtMs = 0;
    parseJsonOrNull({ raw: '{', context: 'x', log, warnEveryMs: 60_000 });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('stripMarkdownCodeFences', () => {
    const plain = 'plain';
    expect(stripMarkdownCodeFences(plain)).toBe(plain);
    expect(stripMarkdownCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripMarkdownCodeFences('a ```\n{"x":1}\n``` b').replace(/\s+/g, ' ').trim()).toBe('a {"x":1} b');
  });

  it('extractFirstJsonSubstring', () => {
    expect(extractFirstJsonSubstring('none')).toBeUndefined();
    expect(extractFirstJsonSubstring('pre {"a":1}')).toBe('{"a":1}');
    expect(extractFirstJsonSubstring('x {"k":"a\\"b"}')).toBe('{"k":"a\\"b"}');
    expect(extractFirstJsonSubstring('{]')).toBeUndefined();
    expect(extractFirstJsonSubstring('[}')).toBeUndefined();
  });

  it('parseLenientTopLevelJson', () => {
    expect(parseLenientTopLevelJson('  ```\n[1,2]\n```  ')).toEqual([1, 2]);
    expect(parseLenientTopLevelJson(String.raw`"{\"a\":1}"`)).toEqual({ a: 1 });
    expect(parseLenientTopLevelJson('noise {"b":2} end')).toEqual({ b: 2 });
    expect(parseLenientTopLevelJson('none')).toBeNull();
  });
});
