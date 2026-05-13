import type { KaytooConfig } from '../../config.js';
import type { FieldPreference } from '../../opensearch/fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import type { AgentPolicy } from '../policy.js';
import type { ToolDef } from './types.js';
import { chattyWorkloads } from './handlers/chattyWorkloads.js';
import { crossNodeBytesByNode } from './handlers/crossNodeBytesByNode.js';
import { destinationTrafficDropsVsBaseline } from './handlers/destinationTrafficDropsVsBaseline.js';
import { namespaceEdgesByBytes } from './handlers/namespaceEdgesByBytes.js';
import { egressBytesVsBaselineTool } from './handlers/egressBytesVsBaseline.js';
import { egressSpikeDrilldownTool } from './handlers/egressSpikeDrilldown.js';
import { ddosCandidates } from './handlers/ddosCandidates.js';
import { flowAggregateTool } from './handlers/flowAggregate.js';
import { ipVersionProtocolRollup } from './handlers/ipVersionProtocolRollup.js';
import { longLivedFlows } from './handlers/longLivedFlows.js';
import { unexpectedPortsVsBaseline } from './handlers/unexpectedPortsVsBaseline.js';
import { topRfc1918OutsideClusterByBytes } from './handlers/topRfc1918OutsideClusterByBytes.js';
import { namespaceTrafficMatrixTool } from './handlers/namespaceTrafficMatrix.js';
import { portscanCandidatesTool } from './handlers/portscanCandidates.js';
import { protocolNamespaceRollupTool } from './handlers/protocolNamespaceRollup.js';
import { rareExternalDestinations } from './handlers/rareExternalDestinations.js';
import { searchFlows } from './handlers/searchFlows.js';
import { tcpFlagPatternsByWorkload } from './handlers/tcpFlagPatternsByWorkload.js';
import { topConversations5Tuple } from './handlers/topConversations5Tuple.js';
import { topDestinationWorkloadsByBytes } from './handlers/topDestinationWorkloadsByBytes.js';
import { topDstIpPortByDistinctSources } from './handlers/topDstIpPortByDistinctSources.js';
import { topExternalDestinationsByBytes } from './handlers/topExternalDestinationsByBytes.js';
import { topFanOut } from './handlers/topFanOut.js';
import { topPortsByBytesAndFlows } from './handlers/topPortsByBytesAndFlows.js';
import { topDestinationsForSource } from './handlers/topDestinationsForSource.js';
import { topServiceFanIn } from './handlers/topServiceFanIn.js';
import { topServiceFanInVsBaseline } from './handlers/topServiceFanInVsBaseline.js';
import { topSourceWorkloadsByBytesPackets } from './handlers/topSourceWorkloadsByBytesPackets.js';
import { topTalkersByBytes } from './handlers/topTalkersByBytes.js';

export type ToolCtxPlain = { client: SearchClient; policy: AgentPolicy; defaultIndex: string };
export type ToolCtxFields = ToolCtxPlain & { fields: FieldPreference };
export type ToolCtxThresholds = ToolCtxFields & { thresholds: KaytooConfig['thresholds'] };
export type ToolCtxBundle = { ctxPlain: ToolCtxPlain; ctxFields: ToolCtxFields; ctxThresholds: ToolCtxThresholds };

export type CoreToolSpec = ToolDef & {
  bind: (ctx: ToolCtxBundle) => (args: Record<string, unknown>) => Promise<unknown>;
};

export const coreToolSpecs: readonly CoreToolSpec[] = [
  {
    name: 'searchFlows',
    description: 'Search recent flow docs with a query DSL and return a few example hits.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        query: { type: 'object' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
      required: ['query'],
    },
    bind: (c) => (args) => searchFlows(c.ctxFields, args),
  },
  {
    name: 'topDestinationsForSource',
    description: 'Aggregate top destination IPs for a given source IP in the last N minutes.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        srcIp: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
      required: ['srcIp'],
    },
    bind: (c) => (args) => topDestinationsForSource(c.ctxFields, args),
  },
  {
    name: 'topTalkersByBytes',
    description:
      'Top source IPs by bytes. Per source: topSrcDisplayNames (hostname/pod-style labels when the index maps srcDisplayNameField), top pod names/namespaces when present; includeDistinctPods adds approximate distinct pod-name cardinality.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        includeDistinctPods: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => topTalkersByBytes(c.ctxPlain, args),
  },
  {
    name: 'topServiceFanIn',
    description:
      'Destinations ranked by distinct client/source IP count (fan-in). Default internalDstOnly restricts to RFC1918 + CGNAT destinations. Optional pod/namespace cardinality and a sample hit per row.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        internalDstOnly: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => topServiceFanIn(c.ctxPlain, args),
  },
  {
    name: 'topServiceFanInVsBaseline',
    description: 'Top internal destinations by fan-in with distinct-source baseline comparison.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        baselineMinutesBack: { type: 'number' },
        size: { type: 'number' },
        internalDstOnly: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => topServiceFanInVsBaseline(c.ctxPlain, args),
  },
  {
    name: 'topSourceWorkloadsByBytesPackets',
    description:
      'Top source IPs by bytes (and packets when available) with top pod/namespaces over the last N minutes.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        includePods: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => topSourceWorkloadsByBytesPackets(c.ctxPlain, args),
  },
  {
    name: 'topDestinationWorkloadsByBytes',
    description:
      'Top destination IPs by bytes (or flows) with destination pod/namespace/service names when mapped.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        orderBy: { type: 'string', description: 'bytes|flows' },
      },
    },
    bind: (c) => (args) => topDestinationWorkloadsByBytes(c.ctxPlain, args),
  },
  {
    name: 'topConversations5Tuple',
    description:
      'Top source->destination conversations by bytes using multi_terms on (srcIp,dstIp,srcPort,dstPort,proto).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => topConversations5Tuple(c.ctxPlain, args),
  },
  {
    name: 'topFanOut',
    description:
      'Sources by fan-out (distinct dst count), bytes, flows. Optional internalDstOnly (RFC1918/CGNAT); includeTopDestinations adds top dst terms per source.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        internalDstOnly: { type: 'boolean' },
        includeTopDestinations: { type: 'boolean' },
        topDestinationsSize: { type: 'number' },
      },
    },
    bind: (c) => (args) => topFanOut(c.ctxPlain, args),
  },
  {
    name: 'topDstIpPortByDistinctSources',
    description: 'Destinations (dstIp,dstPort) ranked by distinct source IP count, plus bytes.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => topDstIpPortByDistinctSources(c.ctxPlain, args),
  },
  {
    name: 'topExternalDestinationsByBytes',
    description: 'Top external destination IPs by egress bytes (RFC1918/CGNAT excluded) with top source pods/namespaces.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => topExternalDestinationsByBytes(c.ctxPlain, args),
  },
  {
    name: 'destinationTrafficDropsVsBaseline',
    description: 'Destinations whose bytes are down vs scaled baseline (drop detection).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        currentMinutesBack: { type: 'number' },
        baselineMinutesBack: { type: 'number' },
        size: { type: 'number' },
        dropThreshold: { type: 'number', description: 'drop if current/expected < threshold' },
        internalDstOnly: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => destinationTrafficDropsVsBaseline(c.ctxPlain, args),
  },
  {
    name: 'topRfc1918OutsideClusterByBytes',
    description:
      'Top sources by bytes to RFC1918 destinations excluding cluster pod/service CIDRs (lateral movement heuristic).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        podCidrs: { type: 'array', items: { type: 'string' } },
        serviceCidrs: { type: 'array', items: { type: 'string' } },
      },
    },
    bind: (c) => (args) => topRfc1918OutsideClusterByBytes(c.ctxPlain, args),
  },
  {
    name: 'topPortsByBytesAndFlows',
    description: 'Top destination ports by bytes and by flow count (separately); includes protocol if mapped.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => topPortsByBytesAndFlows(c.ctxPlain, args),
  },
  {
    name: 'ddosCandidates',
    description: 'Destinations ranked by distinct source IP cardinality (potential DDoS signal) plus bytes/flows.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => ddosCandidates(c.ctxPlain, args),
  },
  {
    name: 'namespaceEdgesByBytes',
    description: 'Top cross-namespace edges by bytes (source namespace -> destination namespace).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => namespaceEdgesByBytes(c.ctxPlain, args),
  },
  {
    name: 'unexpectedPortsVsBaseline',
    description: 'Per workload: destination ports that are significant in a short window vs a longer baseline.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        backgroundMinutesBack: { type: 'number' },
        topWorkloads: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => unexpectedPortsVsBaseline(c.ctxPlain, args),
  },
  {
    name: 'longLivedFlows',
    description: 'Top long-lived flows by duration (requires a duration field) with optional pod/namespace attribution.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => longLivedFlows(c.ctxPlain, args),
  },
  {
    name: 'chattyWorkloads',
    description: 'Workloads with high flow count and low avg bytes/flow (approx) over a short window.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        maxAvgBytesPerFlow: { type: 'number' },
      },
    },
    bind: (c) => (args) => chattyWorkloads(c.ctxPlain, args),
  },
  {
    name: 'crossNodeBytesByNode',
    description: 'Cross-node bytes by source node (requires src/dst node fields).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => crossNodeBytesByNode(c.ctxPlain, args),
  },
  {
    name: 'ipVersionProtocolRollup',
    description: 'Bytes/flows by IP version field x protocol (requires ipVersion field).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => ipVersionProtocolRollup(c.ctxPlain, args),
  },
  {
    name: 'tcpFlagPatternsByWorkload',
    description: 'TCP flags patterns by workload (requires tcp flags + protocol field).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
      },
    },
    bind: (c) => (args) => tcpFlagPatternsByWorkload(c.ctxPlain, args),
  },
  {
    name: 'rareExternalDestinations',
    description:
      'Rare destination IPs (significant_terms vs longer background). applyInsightThresholds: score >= 10.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        currentMinutesBack: { type: 'number' },
        backgroundMinutesBack: { type: 'number' },
        size: { type: 'number' },
        applyInsightThresholds: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => rareExternalDestinations(c.ctxFields, args),
  },
  {
    name: 'portscanCandidates',
    description:
      'Sources by distinct destination-port cardinality plus bytes/packets (insight port-scan query). applyInsightThresholds uses PORTSCAN_* thresholds.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        size: { type: 'number' },
        applyInsightThresholds: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => portscanCandidatesTool(c.ctxThresholds, args),
  },
  {
    name: 'egressBytesVsBaseline',
    description:
      'Per-source bytes vs longer baseline (scaled expected; insight-aligned thresholds). applyInsightThresholds filters to alertable rows. Per-source top dsts: egressSpikeDrilldown.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        currentMinutesBack: { type: 'number' },
        baselineMinutesBack: { type: 'number' },
        currentTopSources: { type: 'number' },
        baselineTopSources: { type: 'number' },
        applyInsightThresholds: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => egressBytesVsBaselineTool(c.ctxThresholds, args),
  },
  {
    name: 'egressSpikeDrilldown',
    description:
      'Top spike sources vs scaled baseline plus top dst IPs per source (current window); same math as egressBytesVsBaseline.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        currentMinutesBack: { type: 'number' },
        baselineMinutesBack: { type: 'number' },
        currentTopSources: { type: 'number' },
        baselineTopSources: { type: 'number' },
        spikeTopK: { type: 'number' },
        destinationsPerSource: { type: 'number' },
        applyInsightThresholds: { type: 'boolean' },
      },
    },
    bind: (c) => (args) => egressSpikeDrilldownTool(c.ctxThresholds, args),
  },
  {
    name: 'namespaceTrafficMatrix',
    description:
      'Per client namespace: bytes (and flow counts) to internal vs external destination IPs (RFC1918/CGNAT vs rest). AZ only if mapped.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        namespaceTermsSize: { type: 'number' },
      },
    },
    bind: (c) => (args) => namespaceTrafficMatrixTool(c.ctxPlain, args),
  },
  {
    name: 'protocolNamespaceRollup',
    description: 'Bytes and flow counts by protocol field x client namespace (both fields must exist).',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        protoTermsSize: { type: 'number' },
        namespaceTermsSize: { type: 'number' },
      },
    },
    bind: (c) => (args) => protocolNamespaceRollupTool(c.ctxPlain, args),
  },
  {
    name: 'flowAggregate',
    description:
      'Capped aggregation-only search: aggs tree of terms|sum|cardinality|date_histogram on @timestamp only; fields from index mapping. No scripts.',
    argsSchema: {
      type: 'object',
      properties: {
        index: { type: 'string' },
        minutesBack: { type: 'number' },
        aggs: { type: 'object' },
      },
      required: ['aggs'],
    },
    bind: (c) => (args) => flowAggregateTool(c.ctxPlain, args),
  },
];

export const coreToolDefinitions: ToolDef[] = coreToolSpecs.map(({ name, description, argsSchema }) => ({
  name,
  description,
  argsSchema,
}));
