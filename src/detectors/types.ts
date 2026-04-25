export type FindingSeverity = 'info' | 'low' | 'medium' | 'high';

export type Finding = {
  id: string;
  kind: 'egress_anomaly' | 'port_scan' | 'rare_destination' | 'opensearch_alert' | 'opensearch_anomaly';
  severity: FindingSeverity;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  window: { from: string; to: string };
};

