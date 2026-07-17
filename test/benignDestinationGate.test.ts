import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/detectors/types.js';
import {
  BENIGN_DST_BYTE_RATIO,
  isLikelyBenignDestinationLabel,
  isPrivateOrCgnatIpv4,
  shouldSuppressVolumeInsight,
} from '../src/insights/benignDestinationGate.js';

function egressFinding(topDestinations: unknown[]): Finding {
  return {
    id: 'egress:192.168.1.190',
    kind: 'egress_anomaly',
    severity: 'high',
    title: 'Unusual egress',
    summary: 'spike',
    evidence: { topDestinations },
    window: { from: 'a', to: 'b' },
  };
}

describe('benignDestinationGate', () => {
  it('classifies RFC1918 and CGNAT', () => {
    expect(isPrivateOrCgnatIpv4('192.168.1.247')).toBe(true);
    expect(isPrivateOrCgnatIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateOrCgnatIpv4('172.16.5.5')).toBe(true);
    expect(isPrivateOrCgnatIpv4('100.64.1.1')).toBe(true);
    expect(isPrivateOrCgnatIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateOrCgnatIpv4('not-an-ip')).toBe(false);
  });

  it('matches CDN/cloud labels', () => {
    expect(isLikelyBenignDestinationLabel('Akamai')).toBe(true);
    expect(isLikelyBenignDestinationLabel('d123.cloudfront.net')).toBe(true);
    expect(isLikelyBenignDestinationLabel('142.250.82.209 (Google)')).toBe(true);
    expect(isLikelyBenignDestinationLabel('reflect9.cs.princeton.edu')).toBe(false);
  });

  it('does not suppress without topDestinations', () => {
    expect(shouldSuppressVolumeInsight(egressFinding([])).suppress).toBe(false);
    expect(
      shouldSuppressVolumeInsight({
        ...egressFinding([]),
        evidence: {},
      }).suppress,
    ).toBe(false);
  });

  it('suppresses CDN-dominated TV/phone volume', () => {
    const r = shouldSuppressVolumeInsight(
      egressFinding([
        {
          dstIp: '139.104.106.41',
          dstEndpointLabel: '139.104.106.41',
          bytes: 100,
        },
        {
          dstIp: '1.1.1.1',
          dstEndpointLabel: 'Akamai CDN',
          bytes: 900,
        },
      ]),
    );
    // 900/1000 = 0.9 but first IP is unknown — only Akamai counts → 0.9
    expect(r.suppress).toBe(true);
    expect(r.benignRatio).toBeGreaterThanOrEqual(BENIGN_DST_BYTE_RATIO);
  });

  it('suppresses Google-dominated phone spike', () => {
    const r = shouldSuppressVolumeInsight(
      egressFinding([
        { dstIp: '142.250.82.209', dstEndpointLabel: '142.250.82.209 (Google)', bytes: 937 },
        { dstIp: '1.2.3.4', dstEndpointLabel: 'Cloudflare', bytes: 20 },
      ]),
    );
    expect(r.suppress).toBe(true);
  });

  it('suppresses LAN-dominated transfers', () => {
    const r = shouldSuppressVolumeInsight(
      egressFinding([
        { dstIp: '192.168.1.247', dstEndpointLabel: '192.168.1.247', bytes: 129 },
        { dstIp: '8.8.8.8', dstEndpointLabel: 'dns', bytes: 1 },
      ]),
    );
    expect(r.suppress).toBe(true);
  });

  it('allows volume to unknown external peer', () => {
    const r = shouldSuppressVolumeInsight(
      egressFinding([
        {
          dstIp: '128.112.136.56',
          dstEndpointLabel: 'reflect9.cs.princeton.edu (128.112.136.56)',
          bytes: 280,
        },
        { dstIp: '1.1.1.1', dstEndpointLabel: 'Cloudflare', bytes: 5 },
      ]),
    );
    expect(r.suppress).toBe(false);
  });

  it('allows when CDN tops are a minority of finding bytes', () => {
    const r = shouldSuppressVolumeInsight({
      ...egressFinding([
        { dstIp: '1.1.1.1', dstEndpointLabel: 'Cloudflare', bytes: 400 },
        { dstIp: '2.2.2.2', dstEndpointLabel: 'Akamai', bytes: 400 },
      ]),
      evidence: {
        bytes: 2000,
        topDestinations: [
          { dstIp: '1.1.1.1', dstEndpointLabel: 'Cloudflare', bytes: 400 },
          { dstIp: '2.2.2.2', dstEndpointLabel: 'Akamai', bytes: 400 },
        ],
      },
    });
    expect(r.suppress).toBe(false);
    expect(r.benignRatio).toBe(0.4);
  });

  it('ignores non-volume finding kinds', () => {
    expect(
      shouldSuppressVolumeInsight({
        id: 'portscan:1',
        kind: 'port_scan',
        severity: 'high',
        title: 'scan',
        summary: 'scan',
        evidence: {
          topDestinations: [{ dstIp: '1.1.1.1', dstEndpointLabel: 'Cloudflare', bytes: 100 }],
        },
        window: { from: 'a', to: 'b' },
      }).suppress,
    ).toBe(false);
  });
});
