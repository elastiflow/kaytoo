import type { ToolDef } from './types.js';

export function buildToolDefinitionList(opts: {
  kbDir: string | undefined;
  kbReady: boolean;
  mcpJsonRpcUrl: string | undefined;
}): ToolDef[] {
  return [
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
    },
    {
      name: 'topTalkersByBytes',
      description:
        'Top source IPs by bytes; includes top pod names / namespaces when mapped; includeDistinctPods adds approximate distinct pod-name cardinality.',
      argsSchema: {
        type: 'object',
        properties: {
          index: { type: 'string' },
          minutesBack: { type: 'number' },
          size: { type: 'number' },
          includeDistinctPods: { type: 'boolean' },
        },
      },
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
    },
    {
      name: 'topSourceWorkloadsByBytesPackets',
      description: 'Top source IPs by bytes (and packets when available) with top pod/namespaces over the last N minutes.',
      argsSchema: {
        type: 'object',
        properties: {
          index: { type: 'string' },
          minutesBack: { type: 'number' },
          size: { type: 'number' },
          includePods: { type: 'boolean' },
        },
      },
    },
    {
      name: 'topDestinationWorkloadsByBytes',
      description: 'Top destination IPs by bytes (or flows) with destination pod/namespace/service names when mapped.',
      argsSchema: {
        type: 'object',
        properties: {
          index: { type: 'string' },
          minutesBack: { type: 'number' },
          size: { type: 'number' },
          orderBy: { type: 'string', description: 'bytes|flows' },
        },
      },
    },
    {
      name: 'topConversations5Tuple',
      description: 'Top source→destination conversations by bytes using multi_terms on (srcIp,dstIp,srcPort,dstPort,proto).',
      argsSchema: {
        type: 'object',
        properties: {
          index: { type: 'string' },
          minutesBack: { type: 'number' },
          size: { type: 'number' },
        },
      },
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
    },
    {
      name: 'namespaceEdgesByBytes',
      description: 'Top cross-namespace edges by bytes (source namespace → destination namespace).',
      argsSchema: {
        type: 'object',
        properties: {
          index: { type: 'string' },
          minutesBack: { type: 'number' },
          size: { type: 'number' },
        },
      },
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
    },
    ...(opts.kbDir && opts.kbReady
      ? [
          {
            name: 'kbSearch',
            description:
              'Search local knowledge base (markdown/text under KAYTOO_KB_DOCS_DIR). Returns snippets with source paths for citations.',
            argsSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                topK: { type: 'number' },
              },
              required: ['query'],
            },
          },
        ]
      : []),
    ...(opts.mcpJsonRpcUrl
      ? [
          {
            name: 'mcpToolCall',
            description:
              'Call a remote tool via JSON-RPC 2.0 at KAYTOO_MCP_JSONRPC_URL (MCP-style bridge). Params: toolName, arguments object.',
            argsSchema: {
              type: 'object',
              properties: {
                toolName: { type: 'string' },
                arguments: { type: 'object' },
              },
              required: ['toolName'],
            },
          },
        ]
      : []),
  ];
}
