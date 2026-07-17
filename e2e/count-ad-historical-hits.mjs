#!/usr/bin/env node
/* eslint-disable no-undef -- e2e OpenSearch AD results/_search hit count */
import http from 'node:http';
import https from 'node:https';
import { buffer } from 'node:stream/consumers';

const [, , base, user, pass, det, task] = process.argv;
if (!base || !user || !pass || !det) {
  console.error('usage: count-ad-historical-hits <osBaseUrl> <user> <pass> <detectorId> [taskId]');
  process.exit(2);
}

const auth = Buffer.from(`${user}:${pass}`).toString('base64');
const u = new URL(base);
const filters = [{ term: { detector_id: det } }, { range: { anomaly_grade: { gt: 0 } } }];
if (task) filters.splice(1, 0, { term: { task_id: task } });
const body = JSON.stringify({
  size: 1,
  query: { bool: { filter: filters } },
});

const opts = {
  hostname: u.hostname,
  port: u.port || (u.protocol === 'https:' ? 443 : 80),
  path: '/_plugins/_anomaly_detection/detectors/results/_search',
  method: 'POST',
  headers: {
    authorization: `Basic ${auth}`,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  },
  rejectUnauthorized: false,
};

const mod = u.protocol === 'https:' ? https : http;

const req = mod.request(opts, async (res) => {
  const bin = await buffer(res);
  const t = bin.toString('utf8');
  if ((res.statusCode ?? 0) >= 400) {
    console.error(t.slice(0, 500));
    process.stdout.write('0');
    process.exit(0);
  }
  try {
    const j = JSON.parse(t);
    const tot = j.hits?.total;
    const n = typeof tot === 'object' && tot !== null ? Number(tot.value ?? 0) : Number(tot ?? 0);
    const hits = Array.isArray(j.hits?.hits) ? j.hits.hits.length : 0;
    process.stdout.write(String(n > 0 ? n : hits));
  } catch {
    process.stdout.write('0');
  }
});
req.on('error', () => {
  process.stdout.write('0');
});
req.write(body);
req.end();
