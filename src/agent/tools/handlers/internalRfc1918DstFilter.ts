const RFC1918_CIDR_TERMS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] as const;
const CGNAT_CIDR_TERM = '100.64.0.0/10' as const;

function cidrTermClauses(dstIpField: string, cidrs: readonly string[]) {
  return cidrs.map((cidr) => ({ term: { [dstIpField]: cidr } }));
}

/**
 * Private IPv4 destination (RFC1918). When `includeCgnat` is true, includes CGNAT 100.64.0.0/10
 * (same shape as historical `internalRfc1918DstIpFilter`).
 */
export function privateIpv4DstBool(dstIpField: string, opts?: { includeCgnat?: boolean }): Record<string, unknown> {
  const cidrs = opts?.includeCgnat ? [...RFC1918_CIDR_TERMS, CGNAT_CIDR_TERM] : [...RFC1918_CIDR_TERMS];
  return {
    bool: {
      should: cidrTermClauses(dstIpField, cidrs),
      minimum_should_match: 1,
    },
  };
}

/** Internal / private destination IPs including CGNAT (for “internal dst” filters in aggregations). */
export function internalRfc1918DstIpFilter(dstIpField: string): Record<string, unknown> {
  return privateIpv4DstBool(dstIpField, { includeCgnat: true });
}
