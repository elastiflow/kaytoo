export function windowFromNow(opts: { minutes: number }): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - opts.minutes * 60_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function windowRelative(opts: { to: Date; minutesBack: number }): { from: string; to: string } {
  const to = opts.to;
  const from = new Date(to.getTime() - opts.minutesBack * 60_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

