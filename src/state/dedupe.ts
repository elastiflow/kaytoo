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

  /** Restore TTL entries from disk (expiry = unix ms). Ignores expired rows. */
  restore(entries: ReadonlyArray<readonly [string, number]>, now = Date.now()): void {
    this.gc(now);
    for (const [k, exp] of entries) {
      if (typeof k === 'string' && typeof exp === 'number' && Number.isFinite(exp) && exp > now) {
        this.seen.set(k, exp);
      }
    }
  }

  /** Current non-expired entries for persistence. */
  snapshot(now = Date.now()): [string, number][] {
    this.gc(now);
    return [...this.seen.entries()];
  }

  private gc(now: number): void {
    for (const [k, exp] of this.seen) {
      if (exp <= now) this.seen.delete(k);
    }
  }
}

