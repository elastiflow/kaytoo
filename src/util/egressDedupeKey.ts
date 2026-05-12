import { isIPv4, isIPv6 } from 'node:net';

/** First /64 of a global-unicast IPv6 (2000::/3), lowercased fixed-width hextets for stable keys. */
export function ipv6GlobalUnicastPrefix64(ip: string): string | null {
  const hextets = expandIpv6ToHextets(ip.trim());
  if (!hextets) return null;
  const first = parseInt(hextets[0]!, 16);
  if (first < 0x2000 || first > 0x3fff) return null;
  return hextets
    .slice(0, 4)
    .map((h) => h.padStart(4, '0'))
    .join(':');
}

/** Stable grouping key for egress anomaly dedupe: IPv4 host, IPv6 /64 for 2000::/3, else full IPv6. */
export function egressDedupeKey(srcIp: string): string {
  const t = srcIp.trim();
  if (isIPv4(t)) return t;
  if (!isIPv6(t)) return t;
  const p64 = ipv6GlobalUnicastPrefix64(t);
  if (p64) return `v6-64:${p64}`;
  return t;
}

function expandIpv6ToHextets(ip: string): string[] | null {
  try {
    const lower = ip.toLowerCase();
    if (!lower.includes('::')) {
      const parts = lower.split(':').filter((x) => x.length > 0);
      if (parts.length !== 8) return null;
      return parts.map((h) => parseInt(h, 16).toString(16));
    }
    const [l, r] = lower.split('::', 2);
    const left = l ? l.split(':').filter(Boolean) : [];
    const right = r ? r.split(':').filter(Boolean) : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const merged = [
      ...left.map((h) => parseInt(h, 16).toString(16)),
      ...Array.from({ length: missing }, () => '0'),
      ...right.map((h) => parseInt(h, 16).toString(16)),
    ];
    return merged.length === 8 ? merged : null;
  } catch {
    return null;
  }
}
