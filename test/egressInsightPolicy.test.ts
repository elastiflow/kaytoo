import { describe, expect, it } from 'vitest';
import {
  EGRESS_BASELINE_MINUTES,
  EGRESS_PRIMARY_CURRENT_MINUTES,
  EGRESS_SPIKE_CURRENT_MINUTES,
  egressInsightWindows,
} from '../src/insights/egressInsightPolicy.js';

describe('egressInsightPolicy', () => {
  it('exports stable window constants', () => {
    expect(egressInsightWindows.primary.currentMinutes).toBe(EGRESS_PRIMARY_CURRENT_MINUTES);
    expect(egressInsightWindows.primary.baselineMinutes).toBe(EGRESS_BASELINE_MINUTES);
    expect(egressInsightWindows.spike.currentMinutes).toBe(EGRESS_SPIKE_CURRENT_MINUTES);
    expect(egressInsightWindows.spike.baselineMinutes).toBe(EGRESS_BASELINE_MINUTES);
  });
});
