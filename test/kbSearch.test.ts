import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isKbDirUsable, searchKnowledgeBase } from '../src/knowledge/kbSearch.js';

describe('searchKnowledgeBase', () => {
  it('ranks markdown hits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-kb-'));
    await writeFile(join(dir, 'runbook.md'), '# Egress\nWatch for unusual egress from internal hosts.\n', 'utf8');
    await writeFile(join(dir, 'other.txt'), 'Nothing relevant here.', 'utf8');
    const hits = await searchKnowledgeBase({
      docsDir: dir,
      query: 'egress internal',
      topK: 5,
      maxSnippetChars: 200,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toContain('runbook');
    expect(hits[0]!.snippet.toLowerCase()).toContain('egress');

    await rm(dir, { recursive: true });
  });

  it('isKbDirUsable: false for file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-kb-file-'));
    const file = join(dir, 'notadir.txt');
    await writeFile(file, 'x', 'utf8');
    await expect(isKbDirUsable(file)).resolves.toBe(false);
    await rm(dir, { recursive: true });
  });

  it('isKbDirUsable: false when missing', async () => {
    await expect(isKbDirUsable(join(tmpdir(), 'kaytoo-kb-does-not-exist-999999'))).resolves.toBe(false);
  });

  it('no hits when tokens empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-kb-tok-'));
    await writeFile(join(dir, 'note.md'), 'alpha beta gamma', 'utf8');
    const hits = await searchKnowledgeBase({
      docsDir: dir,
      query: 'a b',
      topK: 5,
      maxSnippetChars: 50,
    });
    expect(hits).toEqual([]);
    await rm(dir, { recursive: true });
  });

  it('nested dirs; skips non-text files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kaytoo-kb-nested-'));
    await mkdir(join(dir, 'deep'), { recursive: true });
    await writeFile(join(dir, 'deep', 'inner.MD'), '# Deep\nuniquekeyword nested\n', 'utf8');
    await writeFile(join(dir, 'skip.bin'), 'uniquekeyword', 'utf8');
    const hits = await searchKnowledgeBase({
      docsDir: dir,
      query: 'uniquekeyword nested',
      topK: 3,
      maxSnippetChars: 120,
    });
    expect(hits.some((h) => h.path.includes('inner'))).toBe(true);
    expect(hits.every((h) => !h.path.endsWith('.bin'))).toBe(true);
    await rm(dir, { recursive: true });
  });
});
