const SLACK_TS = /^\d+\.\d+$/;

export function chatMessageServerTimeMs(ts: string): number | null {
  const t = ts.trim();
  if (!t) return null;
  if (SLACK_TS.test(t)) {
    const [sec, frac = '0'] = t.split('.');
    const s = Number.parseInt(sec!, 10);
    if (!Number.isFinite(s)) return null;
    const micro = Number.parseInt((frac + '000000').slice(0, 6), 10);
    if (!Number.isFinite(micro)) return null;
    return s * 1000 + micro / 1000;
  }
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : null;
}
