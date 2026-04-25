import { describe, expect, it } from 'vitest';
import {
  getAggBuckets,
  getNested,
  isRecordArgs,
  summarizeHits,
} from '../src/agent/tools/helpers.js';

describe('agent tools helpers', () => {
  it('isRecordArgs rejects arrays and null', () => {
    expect(isRecordArgs({ a: 1 })).toBe(true);
    expect(isRecordArgs([])).toBe(false);
    expect(isRecordArgs(null)).toBe(false);
  });

  it('getNested walks object paths', () => {
    expect(getNested({ a: { b: { c: 3 } } }, ['a', 'b', 'c'])).toBe(3);
    expect(getNested({ a: {} }, ['a', 'missing'])).toBeUndefined();
    expect(getNested(null, ['a'])).toBeUndefined();
  });

  it('getAggBuckets returns only object buckets', () => {
    expect(getAggBuckets({ x: { buckets: [{ key: 1 }, null, 'bad'] } }, ['x', 'buckets'])).toEqual([{ key: 1 }]);
    expect(getAggBuckets({}, ['missing'])).toEqual([]);
  });

  it('summarizeHits truncates and maps hit fields', () => {
    const hits = Array.from({ length: 25 }, (_, i) => ({
      _index: `ix-${i}`,
      _id: `id-${i}`,
      _source: { f: i },
      sort: [i],
    }));
    const summary = summarizeHits({
      hits: {
        total: { value: 100 },
        hits,
      },
    });
    expect((summary as { hits: unknown[] }).hits).toHaveLength(20);
    expect((summary as { total: unknown }).total).toEqual({ value: 100 });
  });

  it('summarizeHits returns empty hits when shape is wrong', () => {
    expect(summarizeHits({})).toEqual({ hits: [] });
    expect(summarizeHits({ hits: { hits: 'nope' } })).toEqual({ hits: [] });
  });
});
