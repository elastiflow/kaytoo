import type { Client } from '@opensearch-project/opensearch';
import type { FieldPreference } from '../opensearch/fieldCaps.js';
import { thrownMessage } from '../util/guards.js';
import { assertIndexAllowed, clampBucketSize, type AgentPolicy } from './policy.js';

const ALLOWED_ROOT_AGG_TYPES = new Set(['terms', 'sum', 'cardinality', 'date_histogram']);

const CALENDAR_INTERVALS = new Set(['1m', '5m', '15m', '1h', '1d']);

function allowedMetricFields(f: FieldPreference): Set<string> {
  const s = new Set<string>([
    f.bytesField,
    f.srcIpField,
    f.dstIpField,
    f.srcPortField,
    f.dstPortField,
    '@timestamp',
  ]);
  if (f.protoField) s.add(f.protoField);
  if (f.podNameField) s.add(f.podNameField);
  if (f.clientNamespaceField) s.add(f.clientNamespaceField);
  if (f.packetsField) s.add(f.packetsField);
  if (f.availabilityZoneField) s.add(f.availabilityZoneField);
  return s;
}

function assertFiniteSize(n: number, policy: AgentPolicy): number {
  return clampBucketSize(n, policy);
}

function sanitizeOrder(order: unknown): Record<string, 'asc' | 'desc'> | undefined {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return undefined;
  const o = order as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1) return undefined;
  const k = keys[0]!;
  const v = o[k];
  if (v !== 'asc' && v !== 'desc') return undefined;
  return { [k]: v };
}

function sanitizeAggBranch(
  node: unknown,
  ctx: { policy: AgentPolicy; allowedFields: Set<string>; remainingDepth: number },
): { node: Record<string, unknown>; childCount: number } {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('invalid agg branch');
  }
  const o = node as Record<string, unknown>;
  const typeKeys = Object.keys(o).filter((k) => ALLOWED_ROOT_AGG_TYPES.has(k));
  if (typeKeys.length !== 1) {
    throw new Error(`agg branch must contain exactly one of: ${[...ALLOWED_ROOT_AGG_TYPES].join(', ')}`);
  }
  const kind = typeKeys[0]!;
  const out: Record<string, unknown> = {};

  if (kind === 'terms') {
    const cfg = o['terms'];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('terms agg requires object');
    const c = cfg as Record<string, unknown>;
    const field = typeof c['field'] === 'string' ? c['field'] : '';
    if (!ctx.allowedFields.has(field)) throw new Error(`terms field not allowed: ${field}`);
    const size = assertFiniteSize(typeof c['size'] === 'number' ? c['size'] : 10, ctx.policy);
    const termsOut: Record<string, unknown> = { field, size };
    const shard = typeof c['shard_size'] === 'number' ? c['shard_size'] : Math.min(5000, size * 50);
    termsOut.shard_size = Math.min(5000, Math.max(shard, size));
    const ord = sanitizeOrder(c['order']);
    if (ord) termsOut.order = ord;
    out.terms = termsOut;
  } else if (kind === 'sum') {
    const cfg = o['sum'];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('sum agg requires object');
    const c = cfg as Record<string, unknown>;
    const field = typeof c['field'] === 'string' ? c['field'] : '';
    if (!ctx.allowedFields.has(field)) throw new Error(`sum field not allowed: ${field}`);
    out.sum = { field };
  } else if (kind === 'cardinality') {
    const cfg = o['cardinality'];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('cardinality agg requires object');
    const c = cfg as Record<string, unknown>;
    const field = typeof c['field'] === 'string' ? c['field'] : '';
    if (!ctx.allowedFields.has(field)) throw new Error(`cardinality field not allowed: ${field}`);
    const pt =
      typeof c['precision_threshold'] === 'number'
        ? Math.min(4000, Math.max(1, Math.floor(c['precision_threshold'])))
        : 3000;
    out.cardinality = { field, precision_threshold: pt };
  } else if (kind === 'date_histogram') {
    const cfg = o['date_histogram'];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('date_histogram agg requires object');
    const c = cfg as Record<string, unknown>;
    const field = typeof c['field'] === 'string' ? c['field'] : '';
    if (field !== '@timestamp') throw new Error('date_histogram field must be @timestamp');
    const cal = typeof c['calendar_interval'] === 'string' ? c['calendar_interval'] : '';
    if (!CALENDAR_INTERVALS.has(cal)) {
      throw new Error(`calendar_interval must be one of: ${[...CALENDAR_INTERVALS].join(', ')}`);
    }
    out.date_histogram = { field, calendar_interval: cal, min_doc_count: 0 };
  }

  const nested = o['aggs'];
  const nestedBuilt =
    nested === undefined
      ? { nextAggs: undefined as Record<string, unknown> | undefined, nestedChildCount: 0 }
      : (() => {
          if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw new Error('aggs must be an object');
          if (ctx.remainingDepth <= 1) throw new Error('max agg depth exceeded');
          const nestedObj = nested as Record<string, unknown>;
          return Object.entries(nestedObj).reduce(
            (acc, [name, child]) => {
              if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(name)) throw new Error(`invalid sub-agg name: ${name}`);
              const built = sanitizeAggBranch(child, { ...ctx, remainingDepth: ctx.remainingDepth - 1 });
              return {
                nextAggs: { ...acc.nextAggs, [name]: built.node },
                nestedChildCount: acc.nestedChildCount + built.childCount,
              };
            },
            { nextAggs: {} as Record<string, unknown>, nestedChildCount: 0 },
          );
        })();

  const sanitized = nestedBuilt.nextAggs === undefined ? out : { ...out, aggs: nestedBuilt.nextAggs };
  const childCount = 1 + nestedBuilt.nestedChildCount;
  return { node: sanitized, childCount };
}

export function validateFlowAggregateAggs(
  aggs: Record<string, unknown>,
  policy: AgentPolicy,
  fields: FieldPreference,
): { ok: true; aggs: Record<string, unknown>; nodeCount: number } | { ok: false; error: string } {
  try {
    const allowedFields = allowedMetricFields(fields);
    const { out, nodeCount } = Object.entries(aggs).reduce(
      (acc, [name, child]) => {
        if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(name)) throw new Error(`invalid root agg name: ${name}`);
        const built = sanitizeAggBranch(child, { policy, allowedFields, remainingDepth: policy.maxAggDepth });
        return {
          out: { ...acc.out, [name]: built.node },
          nodeCount: acc.nodeCount + built.childCount,
        };
      },
      { out: {} as Record<string, unknown>, nodeCount: 0 },
    );
    if (nodeCount > policy.maxAggsNodes) throw new Error(`too many agg nodes (${nodeCount} > ${policy.maxAggsNodes})`);
    return { ok: true, aggs: out, nodeCount };
  } catch (e) {
    return { ok: false, error: thrownMessage(e) };
  }
}

function trimBodyForLlm(body: unknown, maxChars: number): unknown {
  const s = JSON.stringify(body);
  if (s.length <= maxChars) return body;
  return { truncated: true, preview: s.slice(0, maxChars), omittedChars: s.length - maxChars };
}

export async function executeFlowAggregate(opts: {
  client: Client;
  index: string;
  defaultIndex: string;
  minutesBack: number;
  aggs: Record<string, unknown>;
  policy: AgentPolicy;
}): Promise<unknown> {
  const index = opts.index || opts.defaultIndex;
  assertIndexAllowed(index, opts.policy);
  const { body } = await opts.client.search({
    index,
    size: 0,
    timeout: `${opts.policy.aggregateRequestTimeoutMs}ms`,
    body: {
      query: {
        bool: {
          filter: [{ range: { '@timestamp': { gte: `now-${opts.minutesBack}m`, lt: 'now' } } }],
        },
      },
      aggs: opts.aggs,
    } as never,
  });
  return trimBodyForLlm(body, 100_000);
}
