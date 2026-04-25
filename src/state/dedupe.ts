export class DedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  has(key: string, now = Date.now()): boolean {
    this.gc(now);
    const exp = this.seen.get(key);
    if (!exp) return false;
    return exp > now;
  }

  mark(key: string, now = Date.now()): void {
    this.gc(now);
    this.seen.set(key, now + this.ttlMs);
  }

  private gc(now: number): void {
    for (const [k, exp] of this.seen) {
      if (exp <= now) this.seen.delete(k);
    }
  }
}

