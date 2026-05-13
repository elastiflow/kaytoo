export type EgressInsightMode = 'primary' | 'spike';

export const EGRESS_PRIMARY_CURRENT_MINUTES = 60;
export const EGRESS_BASELINE_MINUTES = 24 * 60;
export const EGRESS_SPIKE_CURRENT_MINUTES = 15;

export const egressInsightWindows = {
  primary: {
    currentMinutes: EGRESS_PRIMARY_CURRENT_MINUTES,
    baselineMinutes: EGRESS_BASELINE_MINUTES,
  },
  spike: {
    currentMinutes: EGRESS_SPIKE_CURRENT_MINUTES,
    baselineMinutes: EGRESS_BASELINE_MINUTES,
  },
} as const;
