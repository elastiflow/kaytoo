import { describe, expect, it, vi } from 'vitest';
import { resolveField } from '../src/opensearch/fieldCaps.js';

describe('resolveField', () => {
  it('returns undefined when patterns is empty', async () => {
    const client = { fieldCaps: vi.fn() };
    await expect(
      resolveField({ client: client as never, index: 'i-*', patterns: [] }),
    ).resolves.toBeUndefined();
    expect(client.fieldCaps).not.toHaveBeenCalled();
  });

  it('prefers aggregatable keyword over ip when pattern order matches', async () => {
    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.client.ip.addr': {
              ip: { aggregatable: true },
              keyword: { aggregatable: true },
            },
          },
        },
      }),
    };
    const name = await resolveField({
      client: client as never,
      index: 'ix-*',
      patterns: ['flow.client.ip.addr', 'source.ip'],
    });
    expect(name).toBe('flow.client.ip.addr');
  });

  it('skips types explicitly marked non-aggregatable', async () => {
    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': { long: { aggregatable: false } },
            'network.bytes': { long: { aggregatable: true } },
          },
        },
      }),
    };
    const name = await resolveField({
      client: client as never,
      index: 'ix-*',
      patterns: ['flow.bytes', 'network.bytes'],
    });
    expect(name).toBe('network.bytes');
  });

  it('handles malformed field caps payload with safeParse failure', async () => {
    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: { fields: ['not-a-record'] },
      }),
    };
    const name = await resolveField({
      client: client as never,
      index: 'ix-*',
      patterns: ['flow.bytes'],
    });
    expect(name).toBeUndefined();
  });

  it('scores unknown field entries when byType is empty', async () => {
    const client = {
      fieldCaps: vi.fn().mockResolvedValue({
        body: {
          fields: {
            'flow.bytes': {},
          },
        },
      }),
    };
    const name = await resolveField({
      client: client as never,
      index: 'ix-*',
      patterns: ['flow.bytes'],
    });
    expect(name).toBe('flow.bytes');
  });
});
