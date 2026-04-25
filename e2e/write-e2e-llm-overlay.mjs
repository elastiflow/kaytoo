#!/usr/bin/env node
/* eslint-disable no-undef -- Node CLI */
// Generated Helm values fragment from LLM_BASE_URL, LLM_API_KEY, optional LLM_MODEL (source repo .env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, '.generated/values-e2e.llm.local.json'));
const { LLM_BASE_URL: u, LLM_API_KEY: k, LLM_MODEL: m } = process.env;
if (!u?.trim() || !k?.trim()) {
  console.error('e2e LLM overlay: missing LLM_BASE_URL or LLM_API_KEY (set in repo .env or export before running).');
  process.exit(1);
}

const doc = {
  secrets: { llmApiKey: k },
  config: { llm: { baseUrl: u.trim(), model: (m ?? '').trim() || 'gpt-5.3-codex' } },
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
console.error(`wrote ${out}`);
