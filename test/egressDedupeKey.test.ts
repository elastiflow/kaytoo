import { describe, expect, it } from 'vitest';
import { egressDedupeKey, ipv6GlobalUnicastPrefix64 } from '../src/util/egressDedupeKey.js';

describe('ipv6GlobalUnicastPrefix64', () => {
  it('returns /64 key for 2000::/3 addresses', () => {
    expect(ipv6GlobalUnicastPrefix64('2001:db8::1')).toBe('2001:0db8:0000:0000');
    expect(ipv6GlobalUnicastPrefix64('2001:0db8:0:0:1:2:3:4')).toBe('2001:0db8:0000:0000');
  });

  it('returns null for non-global IPv6', () => {
    expect(ipv6GlobalUnicastPrefix64('fe80::1')).toBeNull();
    expect(ipv6GlobalUnicastPrefix64('fd00::1')).toBeNull();
  });
});

describe('egressDedupeKey', () => {
  it('returns IPv4 unchanged', () => {
    expect(egressDedupeKey('192.168.0.1')).toBe('192.168.0.1');
  });

  it('prefixes global unicast IPv6', () => {
    expect(egressDedupeKey('2001:db8::9')).toMatch(/^v6-64:2001:0db8:0000:0000$/);
  });

  it('keeps full address for link-local', () => {
    expect(egressDedupeKey('fe80::42')).toBe('fe80::42');
  });
});
