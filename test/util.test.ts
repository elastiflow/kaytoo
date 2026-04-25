import { describe, expect, it, vi } from 'vitest';
import { sleepMs } from '../src/util/sleep.js';
import { windowFromNow, windowRelative } from '../src/util/time.js';

describe('util', () => {
  it('sleepMs resolves after the requested time', async () => {
    vi.useFakeTimers();
    const p = sleepMs(50);

    vi.advanceTimersByTime(49);
    const settled = { done: false };
    void p.then(() => {
      settled.done = true;
    });
    await Promise.resolve();
    expect(settled.done).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(settled.done).toBe(true);

    vi.useRealTimers();
  });

  it('windowRelative returns ISO bounds', () => {
    const to = new Date('2020-01-01T00:10:00.000Z');
    const w = windowRelative({ to, minutesBack: 5 });
    expect(w.to).toBe('2020-01-01T00:10:00.000Z');
    expect(w.from).toBe('2020-01-01T00:05:00.000Z');
  });

  it('windowFromNow returns an ISO window ending at now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:10:00.000Z'));

    const w = windowFromNow({ minutes: 5 });
    expect(w.to).toBe('2020-01-01T00:10:00.000Z');
    expect(w.from).toBe('2020-01-01T00:05:00.000Z');

    vi.useRealTimers();
  });
});

