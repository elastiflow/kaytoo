import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type KbHit = {
  id: string;
  path: string;
  snippet: string;
  score: number;
};

const TEXT_EXT = new Set(['.md', '.txt', '.rst']);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

async function collectFiles(dir: string, prefix = ''): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const perName = await Promise.all(
    names.map(async (name) => {
      const rel = prefix ? `${prefix}/${name}` : name;
      const full = join(dir, name);
      const st = await stat(full).catch(() => null);
      if (!st) return [] as string[];
      if (st.isDirectory()) return collectFiles(full, rel);
      const lower = name.toLowerCase();
      const ext = lower.slice(lower.lastIndexOf('.'));
      return TEXT_EXT.has(ext) ? [full] : [];
    }),
  );
  return perName.flat();
}

function tokenMatchScore(contentLower: string, token: string, start: number): number {
  const p = contentLower.indexOf(token, start);
  if (p < 0) return 0;
  return 1 + token.length * 0.01 + tokenMatchScore(contentLower, token, p + token.length);
}

function scoreDoc(contentLower: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, t) => sum + tokenMatchScore(contentLower, t, 0), 0);
}

function snippetAround(content: string, tokens: string[], maxLen: number): string {
  const lower = content.toLowerCase();
  if (tokens.length === 0) return content.slice(0, maxLen).trim();
  const anchor = tokens.reduce(
    (best, t) => {
      const p = lower.indexOf(t);
      if (p < 0) return best;
      const sc = t.length;
      return sc > best.score ? { pos: Math.max(0, p - 40), score: sc } : best;
    },
    { pos: 0, score: -1 },
  );
  const bestPos = anchor.pos;
  const slice = content.slice(bestPos, bestPos + maxLen).trim();
  return slice.length < content.length ? `${slice}...` : slice;
}

export async function searchKnowledgeBase(opts: {
  docsDir: string;
  query: string;
  topK: number;
  maxSnippetChars: number;
}): Promise<KbHit[]> {
  const tokens = tokenize(opts.query);
  const files = await collectFiles(opts.docsDir);
  const scored = (
    await Promise.all(
      files.map(async (abs) => {
        const raw = await readFile(abs, 'utf8').catch(() => null);
        if (raw === null) return [] as KbHit[];
        const lower = raw.toLowerCase();
        const sc = scoreDoc(lower, tokens);
        if (sc <= 0) return [];
        const rel = relative(opts.docsDir, abs);
        return [
          {
            id: rel,
            path: rel,
            snippet: snippetAround(raw, tokens, opts.maxSnippetChars),
            score: sc,
          },
        ];
      }),
    )
  ).flat();

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(20, opts.topK)));
}

export async function isKbDirUsable(dir: string): Promise<boolean> {
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}
