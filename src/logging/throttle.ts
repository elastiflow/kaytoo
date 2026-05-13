/** Returns a gate that yields `true` at most once per `everyMs` per key, `false` otherwise. */
export function createThrottle(everyMs: number): (key?: string) => boolean {
  const at = new Map<string, number>();
  return (key = '') => {
    const now = Date.now();
    if (now < (at.get(key) ?? 0)) return false;
    at.set(key, now + everyMs);
    return true;
  };
}
