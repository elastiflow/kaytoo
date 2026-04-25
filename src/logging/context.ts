import { AsyncLocalStorage } from 'node:async_hooks';

export type LogContext = Record<string, unknown>;

const store = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return store.getStore();
}

export function runWithLogContext<T>(extra: LogContext, fn: () => T): T {
  const parent = store.getStore() ?? {};
  return store.run({ ...parent, ...extra }, fn);
}

export async function runWithLogContextAsync<T>(extra: LogContext, fn: () => Promise<T>): Promise<T> {
  const parent = store.getStore() ?? {};
  return store.run({ ...parent, ...extra }, fn);
}
