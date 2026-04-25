import { getLogger } from '../logging/logger.js';
import { z } from 'zod';
import type { SearchClient } from '../search/types.js';

export type FieldPreference = {
  bytesField: string;
  srcIpField: string;
  dstIpField: string;
  srcPortField: string;
  dstPortField: string;
  protoField?: string;
  podNameField?: string; // source/client
  clientNamespaceField?: string; // source/client
  dstPodNameField?: string;
  dstNamespaceField?: string;
  dstServiceNameField?: string;
  packetsField?: string;
  availabilityZoneField?: string;
  srcNodeField?: string;
  dstNodeField?: string;
  durationMsField?: string;
  tcpFlagsField?: string;
  ipVersionField?: string;
};

const candidateFields = {
  bytes: ['flow.bytes', 'network.bytes'],
  srcIp: ['flow.client.ip.addr', 'source.ip'],
  dstIp: ['flow.server.ip.addr', 'destination.ip'],
  srcPort: ['flow.client.port', 'source.port'],
  dstPort: ['flow.server.port', 'destination.port'],
  proto: ['l4.proto.name', 'network.transport'],
  podName: [
    // Mermin / ElastiFlow flow span fields
    'flow.client.k8s.pod.name',
    'flow.src.k8s.pod.name',
    // Generic / other pipelines
    'kubernetes.pod.name',
    'k8s.pod.name',
    'orchestrator.resource.name',
  ],
  packets: ['network.packets', 'flow.packets'],
  availabilityZone: ['cloud.availability_zone', 'cloud.region', 'availability_zone'],
  dstPodName: [
    'flow.server.k8s.pod.name',
    'flow.dst.k8s.pod.name',
    'destination.kubernetes.pod.name',
    'kubernetes.pod.name',
  ],
  dstNamespace: [
    'flow.server.k8s.namespace.name',
    'flow.dst.k8s.namespace.name',
    'destination.kubernetes.namespace',
    'kubernetes.namespace',
  ],
  dstServiceName: [
    'flow.server.k8s.service.name',
    'flow.dst.k8s.service.name',
    'kubernetes.service.name',
    'destination.service.name',
  ],
  srcNode: ['flow.client.k8s.node.name', 'flow.src.k8s.node.name', 'kubernetes.node.name', 'source.node.name', 'host.name'],
  dstNode: ['flow.server.k8s.node.name', 'flow.dst.k8s.node.name', 'destination.node.name', 'host.name'],
  durationMs: ['event.duration', 'flow.duration', 'network.duration'],
  tcpFlags: ['tcp.flags', 'flow.tcp.flags', 'network.tcp.flags'],
  ipVersion: ['network.type', 'network.iana_number', 'ip.version'],
  clientNamespace: [
    // Mermin / ElastiFlow flow span fields
    'flow.client.k8s.namespace.name',
    'flow.src.k8s.namespace.name',
    'kubernetes.namespace',
    'kubernetes.namespace.name',
    'k8s.namespace.name',
    'source.namespace',
    'orchestrator.namespace',
  ],
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

const warnAt: { nextAtMs: number } = { nextAtMs: 0 };
function warnUnexpectedShape(msg: string): void {
  const now = Date.now();
  if (now < warnAt.nextAtMs) return;
  warnAt.nextAtMs = now + 10 * 60_000;
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
  patterns: string[];
  optional?: boolean;
}): Promise<string | undefined> {
  if (opts.patterns.length === 0) return undefined;
  const resp = await opts.client.fieldCaps({
    index: opts.index,
    fields: opts.patterns,
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
  };
}

