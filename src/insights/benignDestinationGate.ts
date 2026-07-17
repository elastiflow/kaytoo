import { isIPv4 } from 'node:net';
import type { Finding } from '../detectors/types.js';
import { isRecord } from '../util/guards.js';

/** Suppress volume insights when this share of enriched destination bytes look benign. */
export const BENIGN_DST_BYTE_RATIO = 0.8;

/** Best-effort CDN/cloud edge tokens — not threat intel or ASN allowlists. */
const BENIGN_DST_TOKENS = [
  'akamai',
  'cloudfront',
  'fastly',
  'cloudflare',
  'google',
  'googleapis',
  'gvt1',
  'ggpht',
  'youtube',
  'ytimg',
  'apple',
  'icloud',
  'amazonaws',
  'facebook',
  'fbcdn',
  'tiktok',
  'bytedance',
  'netflix',
  'nflx',
  'microsoft',
  'office365',
  'azureedge',
] as const;

type TopDestination = {
  dstIp?: string;
  dstDisplayName?: string;
  dstEndpointLabel?: string;
  bytes?: number;
};

function ipv4Octets(ip: string): number[] | null {
  if (!isIPv4(ip)) return null;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** RFC1918 + CGNAT — mirrors destinationIp.ts ranges. */
export function isPrivateOrCgnatIpv4(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
  return false;
}

export function isLikelyBenignDestinationLabel(label: string): boolean {
  const hay = label.trim().toLowerCase();
  if (!hay) return false;
  return BENIGN_DST_TOKENS.some((t) => hay.includes(t));
}

function destinationLooksBenign(d: TopDestination): boolean {
  const ip = typeof d.dstIp === 'string' ? d.dstIp : '';
  if (ip && isPrivateOrCgnatIpv4(ip)) return true;
  const label = [d.dstEndpointLabel, d.dstDisplayName, ip].filter((s) => typeof s === 'string' && s).join(' ');
  return isLikelyBenignDestinationLabel(label);
}

function parseTopDestinations(evidence: Record<string, unknown>): TopDestination[] {
  const raw = evidence['topDestinations'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!isRecord(row)) return [];
    const bytes = typeof row['bytes'] === 'number' && Number.isFinite(row['bytes']) ? row['bytes'] : 0;
    const dst: TopDestination = { bytes };
    if (typeof row['dstIp'] === 'string') dst.dstIp = row['dstIp'];
    if (typeof row['dstDisplayName'] === 'string') dst.dstDisplayName = row['dstDisplayName'];
    if (typeof row['dstEndpointLabel'] === 'string') dst.dstEndpointLabel = row['dstEndpointLabel'];
    return [dst];
  });
}

export type BenignGateResult = { suppress: boolean; reason?: string; benignRatio?: number };

/** Hard suppress CDN/LAN-dominated volume findings before LLM post. */
export function shouldSuppressVolumeInsight(finding: Finding): BenignGateResult {
  if (finding.kind !== 'egress_anomaly' && finding.kind !== 'opensearch_anomaly') {
    return { suppress: false };
  }
  const tops = parseTopDestinations(finding.evidence);
  if (tops.length === 0) return { suppress: false };

  const totalBytes = tops.reduce((s, d) => s + (d.bytes ?? 0), 0);
  if (totalBytes <= 0) return { suppress: false };

  const benignBytes = tops.reduce((s, d) => s + (destinationLooksBenign(d) ? (d.bytes ?? 0) : 0), 0);
  const benignRatio = benignBytes / totalBytes;
  if (benignRatio < BENIGN_DST_BYTE_RATIO) {
    return { suppress: false, benignRatio };
  }
  return {
    suppress: true,
    benignRatio,
    reason: `benign destinations ≥ ${Math.round(BENIGN_DST_BYTE_RATIO * 100)}% of enriched bytes`,
  };
}
