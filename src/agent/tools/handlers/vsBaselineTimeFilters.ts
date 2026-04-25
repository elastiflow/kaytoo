/** Baseline-only `@timestamp` range that excludes the current window (used in sub-aggregation filters). */
export function baselineSubaggTimestampFilter(baselineMinutesBack: number, currentWindowOffsetMinutes: number) {
  return {
    range: {
      '@timestamp': {
        gte: `now-${baselineMinutesBack + currentWindowOffsetMinutes}m`,
        lt: `now-${currentWindowOffsetMinutes}m`,
      },
    },
  } as const;
}
