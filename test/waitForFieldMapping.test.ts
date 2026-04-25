import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { waitForOpenSearchFieldMapping } from '../src/opensearch/waitForFieldMapping.js';

describe('waitForOpenSearchFieldMapping', () => {
  it('resolves field preferences when fieldCaps returns empty fields', async () => {
    const client = {
      fieldCaps: vi.fn().mockResolvedValue({ body: { fields: {} } }),
    };
    const log = pino({ level: 'silent' });
    const fields = await waitForOpenSearchFieldMapping({
      client: client as never,
      indexPattern: 'flows-*',
      log,
    });
    expect(fields.bytesField).toBe('flow.bytes');
    expect(fields.srcIpField).toBe('flow.client.ip.addr');
    expect(client.fieldCaps).toHaveBeenCalled();
  });
});
