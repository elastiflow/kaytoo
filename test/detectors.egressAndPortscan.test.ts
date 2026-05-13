/** Tests for `detectEgressAnomalies` and `detectPortScans` (branches, severities, and representative happy paths). */
import { describe, expect, it } from 'vitest';
import { detectEgressAnomalies } from '../src/detectors/egressAnomaly.js';
import { detectPortScans } from '../src/detectors/portScan.js';

describe('egress and portscan detectors', () => {
  it('detectEgressAnomalies skips empty ips and rows below threshold', () => {
    const findings = detectEgressAnomalies({
      window: { from: 'a', to: 'b' },
      current: [
        { srcIp: '', bytes: 999 },
        { srcIp: '1.1.1.1', bytes: 10 },
      ],
      baseline: [{ srcIp: '1.1.1.1', bytes: 10_000 }],
      thresholds: { egressMultiplier: 3, egressMinBytes: 50_000_000, portscanDistinctDstPorts: 50, portscanMinPackets: 200 },
      baselineMinutes: 60,
      currentMinutes: 15,
    });

    expect(findings).toEqual([]);
  });

  it('detectEgressAnomalies covers expectedBytes==0 summary and severity tiers', () => {
    const thresholds = { egressMultiplier: 2, egressMinBytes: 10, portscanDistinctDstPorts: 50, portscanMinPackets: 200 };

    // expectedBytes = 0 -> "no baseline" path, and severity "low" (threshold 10, bytes 11)
    const noBaseline = detectEgressAnomalies({
      window: { from: 'a', to: 'b' },
      current: [{ srcIp: '1.1.1.1', bytes: 11 }],
      baseline: [],
      thresholds,
      baselineMinutes: 60,
      currentMinutes: 15,
    });
    expect(noBaseline[0]?.summary).toMatch(/no baseline/i);
    expect(noBaseline[0]?.severity).toBe('low');

    // severity medium (bytes > threshold*2)
    const medium = detectEgressAnomalies({
      window: { from: 'a', to: 'b' },
      current: [{ srcIp: '2.2.2.2', bytes: 100 }],
      baseline: [{ srcIp: '2.2.2.2', bytes: 10 }],
      thresholds,
      baselineMinutes: 60,
      currentMinutes: 60,
    });
    expect(medium[0]?.severity).toBe('medium');

    // severity high (bytes > threshold*5)
    const high = detectEgressAnomalies({
      window: { from: 'a', to: 'b' },
      current: [{ srcIp: '3.3.3.3', bytes: 1000 }],
      baseline: [{ srcIp: '3.3.3.3', bytes: 10 }],
      thresholds,
      baselineMinutes: 60,
      currentMinutes: 60,
    });
    expect(high[0]?.severity).toBe('high');
    expect(high[0]?.summary).toMatch(/expected \(/);
  });

  it('detectPortScans covers skip branches and high/medium severities', () => {
    const thresholds = { egressMultiplier: 3, egressMinBytes: 10, portscanDistinctDstPorts: 10, portscanMinPackets: 5 };
    const window = { from: 'a', to: 'b' };

    expect(
      detectPortScans({
        window,
        rows: [
          { srcIp: '', distinctDstPorts: 999, packets: 999, bytes: 0 },
          { srcIp: '1.1.1.1', distinctDstPorts: 9, packets: 999, bytes: 0 },
          { srcIp: '2.2.2.2', distinctDstPorts: 10, packets: 4, bytes: 0 },
        ],
        thresholds,
      }),
    ).toEqual([]);

    const medium = detectPortScans({
      window,
      rows: [{ srcIp: '3.3.3.3', distinctDstPorts: 10, packets: 5, bytes: 0 }],
      thresholds,
    });
    expect(medium[0]?.severity).toBe('medium');

    const high = detectPortScans({
      window,
      rows: [{ srcIp: '4.4.4.4', distinctDstPorts: 30, packets: 5, bytes: 0 }],
      thresholds,
    });
    expect(high[0]?.severity).toBe('high');
  });

  it('detectEgressAnomalies spike mode uses egress_spike id prefix', () => {
    const thresholds = {
      egressMultiplier: 2,
      egressMinBytes: 10,
      portscanDistinctDstPorts: 50,
      portscanMinPackets: 200,
    };
    const findings = detectEgressAnomalies({
      mode: 'spike',
      window: { from: 'a', to: 'b' },
      current: [{ srcIp: '9.9.9.9', bytes: 500 }],
      baseline: [],
      thresholds,
      baselineMinutes: 60,
      currentMinutes: 15,
    });
    expect(findings[0]?.id.startsWith('egress_spike:')).toBe(true);
  });

  it('uses srcDisplayName in title when present', () => {
    const thresholds = {
      egressMultiplier: 2,
      egressMinBytes: 10,
      portscanDistinctDstPorts: 50,
      portscanMinPackets: 200,
    };
    const findings = detectEgressAnomalies({
      window: { from: 'a', to: 'b' },
      current: [{ srcIp: '10.0.0.2', bytes: 500, srcDisplayName: 'workload-a' }],
      baseline: [],
      thresholds,
      baselineMinutes: 60,
      currentMinutes: 15,
    });
    expect(findings[0]?.title).toContain('workload-a (10.0.0.2)');
  });

  it('flags IPs above baseline multiplier and min bytes for egress anomaly', () => {
    const findings = detectEgressAnomalies({
      window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:15:00.000Z' },
      current: [
        { srcIp: '192.168.1.205', bytes: 500_000_000 },
        { srcIp: '192.168.1.10', bytes: 5_000 },
      ],
      baseline: [{ srcIp: '192.168.1.205', bytes: 1_000_000_000 }],
      thresholds: {
        egressMultiplier: 3,
        egressMinBytes: 50_000_000,
        portscanDistinctDstPorts: 50,
        portscanMinPackets: 200,
      },
      baselineMinutes: 24 * 60,
      currentMinutes: 15,
    });

    expect(findings.some((f) => f.kind === 'egress_anomaly' && f.evidence.srcIp === '192.168.1.205')).toBe(true);
    expect(findings.some((f) => f.evidence.srcIp === '192.168.1.10')).toBe(false);
    const eg = findings.find((f) => f.kind === 'egress_anomaly' && f.evidence.srcIp === '192.168.1.205');
    expect(eg?.evidence.contributingSrcIps).toEqual(['192.168.1.205']);
  });

  it('merges IPv6 global sources in the same /64 into one egress finding', () => {
    const findings = detectEgressAnomalies({
      window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:15:00.000Z' },
      current: [
        { srcIp: '2001:db8::1', bytes: 60_000_000 },
        { srcIp: '2001:db8::2', bytes: 70_000_000 },
      ],
      baseline: [
        { srcIp: '2001:db8::1', bytes: 500 },
        { srcIp: '2001:db8::2', bytes: 500 },
      ],
      thresholds: {
        egressMultiplier: 3,
        egressMinBytes: 50_000_000,
        portscanDistinctDstPorts: 50,
        portscanMinPackets: 200,
      },
      baselineMinutes: 24 * 60,
      currentMinutes: 15,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe('egress:v6-64:2001:0db8:0000:0000');
    expect(findings[0]!.evidence.bytes).toBe(130_000_000);
    expect(findings[0]!.evidence.contributingSrcIps).toEqual(['2001:db8::1', '2001:db8::2']);
    expect(findings[0]!.title).toMatch(/IPv6 \/64/);
  });

  it('IPv6 /64 title includes display name when set', () => {
    const findings = detectEgressAnomalies({
      window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:15:00.000Z' },
      current: [{ srcIp: '2001:db8::1', bytes: 60_000_000, srcDisplayName: 'pod-a' }],
      baseline: [{ srcIp: '2001:db8::1', bytes: 500 }],
      thresholds: {
        egressMultiplier: 3,
        egressMinBytes: 50_000_000,
        portscanDistinctDstPorts: 50,
        portscanMinPackets: 200,
      },
      baselineMinutes: 24 * 60,
      currentMinutes: 15,
    });
    expect(findings[0]?.title).toContain('pod-a (2001:db8::1)');
  });

  it('flags likely port scans based on distinct destination ports and packets', () => {
    const findings = detectPortScans({
      window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:05:00.000Z' },
      rows: [
        { srcIp: '10.0.0.5', distinctDstPorts: 120, packets: 500, bytes: 123_456 },
        { srcIp: '10.0.0.6', distinctDstPorts: 10, packets: 500, bytes: 123_456 },
        { srcIp: '10.0.0.7', distinctDstPorts: 120, packets: 10, bytes: 123_456 },
      ],
      thresholds: {
        egressMultiplier: 3,
        egressMinBytes: 50_000_000,
        portscanDistinctDstPorts: 50,
        portscanMinPackets: 200,
      },
    });

    expect(findings.map((f) => f.evidence.srcIp)).toEqual(['10.0.0.5']);
  });
});
