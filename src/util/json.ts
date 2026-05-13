import type { Logger } from 'pino';
import { logErr } from '../logging/logger.js';
import { thrownMessage } from './guards.js';

const DEFAULT_WARN_EVERY_MS = 10 * 60_000;
const parseWarnAt = new Map<string, number>();

export function snippet(raw: string, n = 800): string {
  return raw.length > n ? `${raw.slice(0, n)}...` : raw;
}

/** Test-only: clear the parse-warn throttle state. */
export function resetJsonParseWarnThrottlesForTests(): void {
  parseWarnAt.clear();
}

function warnParseDegraded(log: Logger, context: string, raw: string, err: unknown, everyMs: number): void {
  const now = Date.now();
  if (now < (parseWarnAt.get(context) ?? 0)) return;
  parseWarnAt.set(context, now + everyMs);
  log.warn({ degradedContext: context, degradedSnippet: snippet(raw), ...logErr(err) }, 'JSON parse degraded');
}

export function parseJsonOrNull(opts: {
  raw: string;
  context: string;
  log?: Logger;
  warnEveryMs?: number;
}): unknown | null {
  try {
    return JSON.parse(opts.raw) as unknown;
  } catch (e) {
    if (opts.log) warnParseDegraded(opts.log, opts.context, opts.raw, e, opts.warnEveryMs ?? DEFAULT_WARN_EVERY_MS);
    return null;
  }
}

/** Lenient variant: strips fences, unwraps once-encoded strings, extracts the first JSON substring. */
export function parseLenientOrNull(opts: {
  raw: string;
  context: string;
  log?: Logger;
  warnEveryMs?: number;
}): unknown | null {
  const v = parseLenientTopLevelJson(opts.raw);
  if (v !== null) return v;
  if (opts.log) {
    const err = new Error('unparseable JSON');
    warnParseDegraded(opts.log, opts.context, opts.raw, err, opts.warnEveryMs ?? DEFAULT_WARN_EVERY_MS);
  }
  return null;
}

export function parseJsonOrThrow(opts: { raw: string; context: string }): unknown {
  try {
    return JSON.parse(opts.raw) as unknown;
  } catch (e) {
    const msg = thrownMessage(e);
    const errMsg = `${opts.context}: invalid JSON (${msg}); body=${snippet(opts.raw)}`;
    throw new Error(errMsg, e instanceof Error ? { cause: e } : undefined);
  }
}

/** Strip ``` fenced blocks (```json ... ```) from assistant-style content. */
export function stripMarkdownCodeFences(s: string): string {
  if (!s.includes('```')) return s;
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (m) return (m[1] ?? '').trim();
  return t
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\n/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** First balanced `{...}` or `[...]` substring starting at the earliest `{` or `[`. */
export function extractFirstJsonSubstring(s: string): string | undefined {
  const start = Math.min(
    ...['{', '[']
      .map((c) => s.indexOf(c))
      .filter((i) => i >= 0),
  );
  if (!Number.isFinite(start)) return undefined;

  const stack: string[] = [];
  const state = { inStr: false, esc: false, pos: start };
  for (const ch of s.slice(start)) {
    if (state.inStr) {
      if (state.esc) {
        state.esc = false;
        state.pos++;
        continue;
      }
      if (ch === '\\') {
        state.esc = true;
        state.pos++;
        continue;
      }
      if (ch === '"') state.inStr = false;
      state.pos++;
      continue;
    }
    if (ch === '"') {
      state.inStr = true;
      state.pos++;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      state.pos++;
      continue;
    }
    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return undefined;
      if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) return undefined;
      if (stack.length === 0) return s.slice(start, state.pos + 1).trim();
    }
    state.pos++;
  }
  return undefined;
}

/**
 * Lenient parse for model output: trim, strip fences, unwrap a JSON-encoded string once,
 * then optionally extract embedded JSON. No logging (caller handles failures).
 */
export function parseLenientTopLevelJson(raw: string): unknown | null {
  const parseOnce = (x: string): unknown => {
    try {
      return JSON.parse(x) as unknown;
    } catch {
      return null;
    }
  };

  const trimmed = raw.trim();
  const deFenced = stripMarkdownCodeFences(trimmed);

  const attempt = (x: string): unknown => {
    const first = parseOnce(x);
    if (typeof first === 'string') {
      const t = first.trim();
      if (t.startsWith('{') || t.startsWith('[')) return parseOnce(t);
    }
    return first;
  };

  const direct = attempt(deFenced);
  if (direct !== null) return direct;

  const extracted = extractFirstJsonSubstring(deFenced);
  if (extracted) {
    const v = attempt(extracted);
    if (v !== null) return v;
  }

  return null;
}

