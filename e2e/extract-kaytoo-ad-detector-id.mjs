#!/usr/bin/env node
/* eslint-disable no-undef -- stdin JSON helper for e2e/cli.sh */
import fs from 'node:fs';

const want = 'Kaytoo flow egress by source';
const raw = fs.readFileSync(0, 'utf8');
let j;
try {
  j = JSON.parse(raw);
} catch {
  console.error('invalid JSON on stdin');
  process.exit(1);
}

if (Array.isArray(j.detectorList)) {
  for (const d of j.detectorList) {
    if (!d || typeof d !== 'object') continue;
    const n = d.name;
    const id = d.id;
    if (typeof id !== 'string' || !id) continue;
    if (n === want || (typeof n === 'string' && n.includes('Kaytoo flow egress'))) {
      process.stdout.write(id);
      process.exit(0);
    }
  }
}

const hits = j.hits?.hits;
if (Array.isArray(hits)) {
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue;
    const id = typeof h._id === 'string' ? h._id : '';
    const src = h._source && typeof h._source === 'object' ? h._source : {};
    const n = src.name;
    if (!id) continue;
    if (n === want || (typeof n === 'string' && n.includes('Kaytoo flow egress'))) {
      process.stdout.write(id);
      process.exit(0);
    }
  }
}

console.error('no Kaytoo AD detector id in detectors/_search response');
process.exit(1);
