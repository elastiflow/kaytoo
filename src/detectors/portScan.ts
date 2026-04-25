import type { KaytooConfig } from '../config.js';
import type { PortscanAggRow } from '../opensearch/queries/index.js';
import type { Finding } from './types.js';

export function detectPortScans(opts: {
  window: { from: string; to: string };
  rows: PortscanAggRow[];
  thresholds: KaytooConfig['thresholds'];
}): Finding[] {
  return opts.rows.flatMap((row) => {
    if (!row.srcIp) return [];
    if (row.distinctDstPorts < opts.thresholds.portscanDistinctDstPorts) return [];
    if (row.packets < opts.thresholds.portscanMinPackets) return [];

    const severity: Finding['severity'] =
      row.distinctDstPorts >= opts.thresholds.portscanDistinctDstPorts * 3 ? 'high' : 'medium';

    return [
      {
        id: `portscan:${row.srcIp}`,
        kind: 'port_scan' as const,
        severity,
        title: `Possible port scan from ${row.srcIp}`,
        summary: `${row.srcIp} contacted ${Math.round(row.distinctDstPorts).toLocaleString()} distinct destination ports in the window.`,
        evidence: {
          srcIp: row.srcIp,
          distinctDstPorts: row.distinctDstPorts,
          packets: row.packets,
          bytes: row.bytes,
          thresholds: {
            portscanDistinctDstPorts: opts.thresholds.portscanDistinctDstPorts,
            portscanMinPackets: opts.thresholds.portscanMinPackets,
          },
        },
        window: opts.window,
      },
    ];
  });
}
