import { describe, expect, it, vi } from 'vitest';
import { getBuckets, timedSearch, toNumber, toString } from '../src/opensearch/queries/shared.js';

type SearchClient = { search: ReturnType<typeof vi.fn> };

describe('opensearch queries shared', () => {
  it('timedSearch labels string index and logs failures', async () => {
    const client: SearchClient = {
      search: vi.fn().mockRejectedValue(new Error('search boom')),
    };
    await expect(timedSearch('testOp', client as never, { index: 'ix-*', body: {} } as never)).rejects.toThrow(
      'search boom',
    );
    expect(client.search).toHaveBeenCalled();
  });

  it('timedSearch joins array index labels', async () => {
    const client: SearchClient = { search: vi.fn().mockResolvedValue({ body: {} }) };
    await timedSearch('x', client as never, { index: ['a-*', 'b-*'], body: {} } as never);
    expect(client.search).toHaveBeenCalled();
  });

  it('timedSearch uses empty index label when params are not an object', async () => {
    const client: SearchClient = { search: vi.fn().mockResolvedValue({ body: {} }) };
    await timedSearch('x', client as never, null as never);
    expect(client.search).toHaveBeenCalledWith(null);
  });

  it('getBuckets filters non-objects', () => {
    expect(getBuckets({ hits: { buckets: [{ key: 1 }, null, 3] } }, ['hits', 'buckets'])).toEqual([{ key: 1 }]);
  });

  it('toNumber and toString coerce primitives', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('x')).toBe(0);
    expect(toString('a')).toBe('a');
    expect(toString(1)).toBe('');
  });
});
