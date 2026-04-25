function rfc1918AndCgnatDestinationShould(dstIpField: string): unknown[] {
  return [
    { range: { [dstIpField]: { gte: '10.0.0.0', lte: '10.255.255.255' } } },
    { range: { [dstIpField]: { gte: '172.16.0.0', lte: '172.31.255.255' } } },
    { range: { [dstIpField]: { gte: '192.168.0.0', lte: '192.168.255.255' } } },
    { range: { [dstIpField]: { gte: '100.64.0.0', lte: '100.127.255.255' } } },
  ];
}

/** RFC1918 + CGNAT 100.64/10 destination IPs. */
export function internalDestinationIpBool(dstIpField: string): Record<string, unknown> {
  return {
    bool: {
      should: rfc1918AndCgnatDestinationShould(dstIpField) as never,
      minimum_should_match: 1,
    },
  };
}

export function externalDestinationIpBool(dstIpField: string): Record<string, unknown> {
  return { bool: { must_not: [internalDestinationIpBool(dstIpField)] } };
}
