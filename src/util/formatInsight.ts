export function formatEndpointLabel(opts: { displayName?: string | null | undefined; ip: string }): string {
  const dn = opts.displayName?.trim();
  if (dn) return `${dn} (${opts.ip})`;
  return opts.ip;
}

export function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(v)} ${units[i]}`;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
