#!/usr/bin/env node
/* eslint-disable no-undef -- Node CLI */
import https from 'node:https';
import { buffer } from 'node:stream/consumers';

const cmd = process.argv[2] ?? '';
const argv = process.argv.slice(3);

const usage = () => {
  console.error('usage: node e2e/chat.mjs basics|top-talkers|eval');
  process.exit(2);
};

const base = (process.env.CHAT_BASE ?? 'http://127.0.0.1:18080').replace(/\/$/, '');

const snip = (s, n = 800) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}...` : t;
};

async function jsonFetch(url, init) {
  const r = await fetch(url, init);
  const t = await r.text();
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${snip(t)}`);
  try {
    return JSON.parse(t);
  } catch (err) {
    const msg = `${url} -> invalid JSON: ${err instanceof Error ? err.message : String(err)}; body=${snip(t)}`;
    throw new Error(msg, { cause: err });
  }
}

const chatGetJson = (path) => jsonFetch(`${base}${path}`, { method: 'GET' });
const chatPostJson = (path, body) =>
  jsonFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function osFromEnv(env = process.env) {
  const u = env.OS_URL;
  const user = env.OS_USER;
  const pass = env.OS_PASS;
  if (!u?.trim() || !user?.trim() || !pass?.trim()) throw new Error('missing OS_URL, OS_USER, or OS_PASS');
  return { url: new URL(u), auth: `${user}:${pass}` };
}

function osReq(ctx, method, path, hdrs, body) {
  const { url, auth } = ctx;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path,
        method,
        headers: { authorization: `Basic ${Buffer.from(auth).toString('base64')}`, ...hdrs },
        rejectUnauthorized: false,
      },
      (res) => {
        void buffer(res)
          .then((bin) => {
            const t = bin.toString('utf8');
            if ((res.statusCode ?? 0) >= 400) throw new Error(`${path} -> ${res.statusCode}: ${t.slice(0, 500)}`);
            resolve(JSON.parse(t));
          })
          .catch(reject);
      },
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function osJson(ctx, method, path, body) {
  const p = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return osReq(ctx, method, path, p ? { 'content-type': 'application/json' } : {}, p ?? undefined);
}

async function basics() {
  const p = '[assert-chat-basics]';
  const die = (m, ...x) => {
    console.error(`${p} ${m}`);
    x.forEach((e) => console.error(e));
    process.exit(1);
  };
  const h = await chatGetJson('/health');
  if (!h || typeof h !== 'object' || h.ok !== true) die('GET /health want { ok: true }', h);
  console.error(`${p} /health ok`);
  for (const [text, rx] of [
    ['help', /kaytoo commands/i],
    ['status', /\bok\b/i],
  ]) {
    const res = await chatPostJson('/chat', { text });
    const body = (Array.isArray(res?.replies) ? res.replies : []).join('\n');
    if (!body.trim()) die(`POST /chat empty replies ${JSON.stringify(text)}`, res);
    if (!rx.test(body)) die(`POST /chat want ${rx} for ${JSON.stringify(text)}`, body.slice(0, 2000));
    console.error(`${p} /chat ${text} ok (${body.length})`);
  }
  console.error(`${p} OK`);
}

async function topTalkers() {
  const p = '[assert-top-talkers]';
  const die = (m, ...x) => {
    console.error(`${p} ${m}`);
    x.forEach((e) => console.error(e));
    process.exit(1);
  };
  const e = process.env;
  const os = osFromEnv(e);
  const idx = e.OS_INDEX_PATTERN ?? 'elastiflow-flow-codex-*';
  const mins = Number(e.TOP_TALKERS_MINUTES_BACK ?? 10080);
  const path = `/${encodeURIComponent(idx)}`;
  const n = (await osJson(os, 'POST', `${path}/_count`, { query: { match_all: {} } })).count ?? 0;
  if (n < 1) die(`no documents in ${idx} (count=${n})`);
  console.error(`${p} ${idx} document count: ${n}`);
  const agg = await osJson(os, 'POST', `${path}/_search`, {
    size: 0,
    query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${mins}m`, lt: 'now' } } }] } },
    aggs: {
      by_src: {
        terms: { field: 'flow.client.ip.addr', size: 5, order: { sum_bytes: 'desc' } },
        aggs: { sum_bytes: { sum: { field: 'flow.bytes' } } },
      },
    },
  });
  const topIps = (agg.aggregations?.by_src?.buckets ?? []).map((b) => String(b.key)).filter(Boolean);
  if (!topIps.length) die('aggregation returned no talker buckets');
  console.error(`${p} top talker IPs from OpenSearch: ${topIps.join(', ')}`);
  const q =
    e.TOP_TALKERS_QUESTION ??
    'What is the pod name (from flow records) for each of the top 5 talkers by total bytes in the last 7 days? Use the topTalkersByBytes tool first, then answer. List each talker IP, total bytes, and pod name if present.';
  const chat = await chatPostJson('/chat', { text: q });
  const text = (Array.isArray(chat.replies) ? chat.replies : []).join('\n');
  if (!text.trim()) die('empty replies from /chat', chat);
  const lo = text.toLowerCase();
  const ip = topIps.find((x) => lo.includes(x.toLowerCase()));
  if (!ip) die('reply did not reference any top-5 talker IP from OpenSearch.', text.slice(0, 4000));
  if (text.length < 80) die('reply too short to be substantive');
  if (lo.includes('"tool_calls"') || lo.includes('\\"tool_calls\\"'))
    die('reply included raw tool_calls JSON; tools likely not executed', text.slice(0, 4000));
  console.error(`${p} reply references talker IP ${ip} (${text.length} chars)`);
  console.error(`${p} OK`);
}

async function evalQuestions() {
  const delay = Number(process.env.EVAL_DELAY_MS ?? 500);
  const q = [
    { label: 'F1-top-talkers', text: 'What are the top 3 source IPs by total bytes in the last 15 minutes, and any pod or namespace names shown in flow data? Use tools; cite numbers.' },
    { label: 'F2-namespace-matrix', text: 'In the last 60 minutes, which Kubernetes namespaces (client side) had the most internal vs external bytes according to flow records? Use namespaceTrafficMatrix.' },
    { label: 'F3-egress-spike-drill', text: 'Which source IPs spiked most in egress bytes versus a 7-day baseline, and what are their top destination IPs? Use egressSpikeDrilldown with baselineMinutesBack=10080.' },
    { label: 'F4-internal-fanout', text: 'Which sources had the highest fan-out to internal (RFC1918/CGNAT) destinations in the last 30 minutes, and what were their top few destination IPs? Use topFanOut with internalDstOnly and includeTopDestinations.' },
    { label: 'F5-external-dest', text: 'List the top 5 external (non-RFC1918) destination IPs by egress bytes in the last 60 minutes. Use topExternalDestinationsByBytes.' },
    { label: 'F6-rare-dest', text: 'Any rare or unusual external destinations in the last 24 hours worth a look? Call rareExternalDestinations with a reasonable window and summarize.' },
    { label: 'N1-bgp', text: 'What was the exact BGP NOTIFICATION error code for the last flap on router core1? Answer from flow data only.' },
    { label: 'N2-stp', text: 'Who is the spanning tree root bridge for VLAN 200 in our datacenter? Use flow records to prove it.' },
    { label: 'N3-kube-proxy', text: 'Compare kube-proxy iptables vs IPVS modes for a 5000-node cluster: which wins for tail latency on ClusterIP Services and why?' },
    { label: 'N4-mtu', text: 'What is the configured MTU on interface eth0 of GKE node gke-pool-abc-def? Answer definitively from elastiflow indices.' },
    { label: 'N5-pci', text: 'Quote PCI DSS requirement 10.2 verbatim and map each bullet to our NetFlow field names.' },
    { label: 'C1-name', text: 'What is your name?' },
    { label: 'C2-capabilities', text: 'What can you do?' },
    { label: 'C3-math', text: 'What is 17 times 3?' },
    { label: 'C4-color', text: 'What is your favorite color?' },
    { label: 'C5-haiku', text: 'Write a haiku about coffee.' },
  ];
  const out = [];
  for (const { label, text } of q) {
    console.error(`\n>>> ${label} ...`);
    try {
      await chatPostJson('/chat', { text: 'reset' });
      await new Promise((r) => setTimeout(r, delay));
      const t0 = Date.now();
      const res = await chatPostJson('/chat', { text });
      const answer = (Array.isArray(res?.replies) ? res.replies : []).join('\n').trim();
      const row = { label, text, ms: Date.now() - t0, answer };
      out.push(row);
      console.error(`    (${row.ms}ms, ${answer.length} chars)`);
    } catch (e) {
      out.push({ label, text, ms: 0, answer: String(e) });
      console.error(`    ERROR ${e}`);
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

if (!cmd) usage();
if (cmd === 'basics') await basics();
else if (cmd === 'top-talkers') await topTalkers();
else if (cmd === 'eval') await evalQuestions(argv);
else usage();
