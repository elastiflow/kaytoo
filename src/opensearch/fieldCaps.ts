import { getLogger } from '../logging/logger.js';
import { createThrottle } from '../logging/throttle.js';
import { z } from 'zod';
import type { SearchClient } from '../search/types.js';
import { candidateFields } from './fieldCandidates.js';

export type FieldPreference = {
  bytesField: string;
  srcIpField: string;
  dstIpField: string;
  srcPortField: string;
  dstPortField: string;
  protoField?: string;
  podNameField?: string;
  clientNamespaceField?: string;
  dstPodNameField?: string;
  dstNamespaceField?: string;
  dstServiceNameField?: string;
  packetsField?: string;
  availabilityZoneField?: string;
  srcNodeField?: string;
  dstNodeField?: string;
  srcDisplayNameField?: string;
  dstDisplayNameField?: string;
  durationMsField?: string;
  tcpFlagsField?: string;
  ipVersionField?: string;
};

type FieldCapsByField = Record<string, Record<string, { aggregatable?: boolean }>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const fieldCapsFieldsSchema = z.record(z.string(), z.unknown());

function decodeFieldCapsFields(fields: Record<string, unknown>): FieldCapsByField {
  const out: FieldCapsByField = {};
  for (const [field, byTypeRaw] of Object.entries(fields)) {
    if (!isRecord(byTypeRaw)) {
      out[field] = {};
      continue;
    }
    const byType: Record<string, { aggregatable?: boolean }> = {};
    for (const [t, metaRaw] of Object.entries(byTypeRaw)) {
      if (!isRecord(metaRaw)) continue;
      const aggregatable = typeof metaRaw['aggregatable'] === 'boolean' ? (metaRaw['aggregatable'] as boolean) : undefined;
      byType[t] = aggregatable !== undefined ? { aggregatable } : {};
    }
    out[field] = byType;
  }
  return out;
}

const shouldWarnUnexpectedShape = createThrottle(10 * 60_000);
function warnUnexpectedShape(msg: string): void {
  if (!shouldWarnUnexpectedShape()) return;
  getLogger({ component: 'opensearch.fieldCaps' }).warn({ degradedMsg: msg }, 'unexpected fieldCaps response shape');
}

function typeRank(t: string): number {
  switch (t) {
    case 'keyword':
      return 0;
    case 'ip':
      return 1;
    case 'long':
    case 'integer':
    case 'short':
    case 'byte':
      return 2;
    case 'double':
    case 'float':
    case 'half_float':
    case 'scaled_float':
      return 3;
    case 'text':
      return 8;
    default:
      return 9;
  }
}

export async function resolveField(opts: {
  client: SearchClient;
  index: string;
  patterns: readonly string[];
  optional?: boolean;
}): Promise<string | undefined> {
  if (opts.patterns.length === 0) return undefined;
  const resp = await opts.client.fieldCaps({
    index: opts.index,
    fields: [...opts.patterns],
    ignore_unavailable: true,
    allow_no_indices: true,
  });

  const body = (resp as { body?: unknown } | null | undefined)?.body;
  const caps = (((body as { fields?: Record<string, unknown> } | undefined) ?? {}).fields ?? {}) as Record<string, unknown>;
  const decoded = fieldCapsFieldsSchema.safeParse(caps);
  const byField: FieldCapsByField = decoded.success ? decodeFieldCapsFields(decoded.data) : {};
  if (!decoded.success) warnUnexpectedShape(decoded.error.message);

  const candidates: Array<{ name: string; score: number }> = [];
  for (const [name, byType] of Object.entries(byField)) {
    if (!byType || typeof byType !== 'object' || Object.keys(byType).length === 0) {
      const patternIdx = opts.patterns.findIndex((p) => p === name);
      const patScore = patternIdx >= 0 ? patternIdx : opts.patterns.length + 1;
      candidates.push({ name, score: patScore * 100 + typeRank('unknown') * 10 + Math.min(name.length, 80) });
      continue;
    }
    for (const [t, meta] of Object.entries(byType)) {
      // Some OpenSearch/clients omit `aggregatable`; treat missing as usable and
      // rely on query-time errors + tests to catch truly non-aggregatable fields.
      if (meta && meta.aggregatable === false) continue;
      // Prefer earlier patterns, better types, and shorter names.
      const patternIdx = opts.patterns.findIndex((p) => p === name);
      const patScore = patternIdx >= 0 ? patternIdx : opts.patterns.length + 1;
      const score = patScore * 100 + typeRank(t) * 10 + Math.min(name.length, 80);
      candidates.push({ name, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.name;
}

export async function chooseFields(opts: {
  client: SearchClient;
  index: string;
}): Promise<FieldPreference> {
  const [bytesField, srcIpField, dstIpField, srcPortField, dstPortField, protoField] = await Promise.all([
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.bytes }).then(
      (v) => v ?? candidateFields.bytes[0]!,
    ),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.srcIp }).then(
      (v) => v ?? candidateFields.srcIp[0]!,
    ),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstIp }).then(
      (v) => v ?? candidateFields.dstIp[0]!,
    ),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.srcPort }).then(
      (v) => v ?? candidateFields.srcPort[0]!,
    ),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstPort }).then(
      (v) => v ?? candidateFields.dstPort[0]!,
    ),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.proto }).then(
      (v) => v ?? candidateFields.proto[0]!,
    ),
  ]);

  const [
    podNameField,
    packetsField,
    availabilityZoneField,
    clientNamespaceField,
    dstPodNameField,
    dstNamespaceField,
    dstServiceNameField,
    srcNodeField,
    dstNodeField,
    durationMsField,
    tcpFlagsField,
    ipVersionField,
    srcDisplayNameField,
    dstDisplayNameField,
  ] = await Promise.all([
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.podName }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.packets }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.availabilityZone }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.clientNamespace }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstPodName }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstNamespace }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstServiceName }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.srcNode }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstNode }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.durationMs }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.tcpFlags }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.ipVersion }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.srcDisplayName }),
    resolveField({ client: opts.client, index: opts.index, patterns: candidateFields.dstDisplayName }),
  ]);

  return {
    bytesField,
    srcIpField,
    dstIpField,
    srcPortField,
    dstPortField,
    protoField,
    ...(podNameField ? { podNameField } : {}),
    ...(packetsField ? { packetsField } : {}),
    ...(availabilityZoneField ? { availabilityZoneField } : {}),
    ...(clientNamespaceField ? { clientNamespaceField } : {}),
    ...(dstPodNameField ? { dstPodNameField } : {}),
    ...(dstNamespaceField ? { dstNamespaceField } : {}),
    ...(dstServiceNameField ? { dstServiceNameField } : {}),
    ...(srcNodeField ? { srcNodeField } : {}),
    ...(dstNodeField ? { dstNodeField } : {}),
    ...(durationMsField ? { durationMsField } : {}),
    ...(tcpFlagsField ? { tcpFlagsField } : {}),
    ...(ipVersionField ? { ipVersionField } : {}),
    ...(srcDisplayNameField ? { srcDisplayNameField } : {}),
    ...(dstDisplayNameField ? { dstDisplayNameField } : {}),
  };
}

