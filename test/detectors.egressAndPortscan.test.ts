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
    expect(high[0]?.summary).toMatch(/vs expected/i);
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
