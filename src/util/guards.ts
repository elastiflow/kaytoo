export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function getString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function getNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

export function thrownMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
