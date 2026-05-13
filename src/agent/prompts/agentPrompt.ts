import type { ConversationTurn } from '../../storage/conversationStore.js';
import type { ChatMessage } from '../../llm/types.js';
import type { ToolResult } from '../tools/index.js';
import {
  AGENT_JSON_TOOL_CALLS_SINGLE_OBJECT,
  DEFAULT_AGENT_MINUTES_BACK,
  KAYTOO_AGENT_SYSTEM_IDENTITY,
  type AgentIntent,
} from './intentMetadata.js';

export function buildAgentPrompt(opts: {
  tools: Array<{ name: string; description: string; argsSchema: unknown }>;
  turns: ConversationTurn[];
  toolResults: ToolResult[];
  intent: AgentIntent;
  summary?: string;
}): ChatMessage[] {
  const tooling = opts.tools.map((t) => t.name).sort().join(', ');

  const contract = buildAgentPromptContract({ intent: opts.intent, tooling });
  const playbooks = buildAgentPromptPlaybooks(opts.intent);

  const system: ChatMessage = {
    role: 'system',
    content: [...contract, '', ...playbooks].join('\n').replace(/\n{3,}/g, '\n\n'),
  };

  const context: ChatMessage = {
    role: 'user',
    content: JSON.stringify({
      available_tools: opts.tools,
      conversation_summary: opts.summary ?? '',
      recent_conversation: opts.turns.slice(-10),
      recent_tool_results: opts.toolResults,
    }),
  };

  return [system, context];
}

function buildAgentPromptContract(opts: { intent: AgentIntent; tooling: string }): string[] {
  return [
    `${KAYTOO_AGENT_SYSTEM_IDENTITY}.`,
    'Use tools for flow analytics. Do not guess.',
    'If a question cannot be answered from flow data (e.g. BGP NOTIFICATION sender, STP root cause, ' +
      'EVPN control-plane), return a brief, decision-oriented workflow and explicitly say what evidence is ' +
      'needed (logs/show commands/pcap).',
    '',
    `Tooling: ${opts.tooling}`,
    'State data limits plainly (e.g. missing AZ).',
    'When summarizing tool output, use human byte sizes (KB/MB/GB) and Name (ip) when both exist.',
    '',
    `Intent: ${opts.intent}.`,
    ...(opts.intent === 'TROUBLESHOOTING'
      ? [
          'Default for troubleshooting: keep it short (<= 10 lines). Start with 1-2 most likely causes, ' +
            'then 3-5 checks in order.',
          'Use flow tools only for symptom support (who/what/when/volume/directionality), not for ' +
            'control-plane root-cause claims.',
        ]
      : []),
    ...(opts.intent === 'GENERAL_CHAT'
      ? [
          'Short replies; use tools only when the user wants flows, kbSearch, or MCP-backed actions.',
        ]
      : []),
    '',
    'Output MUST be a single top-level JSON object and nothing else.',
    `- If you need tools: ${AGENT_JSON_TOOL_CALLS_SINGLE_OBJECT}`,
    '- If you are answering: {"reply":"..."}',
    'Never put JSON inside a quoted string.',
  ];
}

function flowPlaybooksCompressed(): string[] {
  return [
    'Flow analytics playbooks:',
    '- Prefer aggregate tools over searchFlows unless you need a narrow raw slice.',
    `- Read parameters from each tool in available_tools (context JSON). Default minutesBack=${DEFAULT_AGENT_MINUTES_BACK} if unspecified.`,
    '- State plainly when expected fields are missing (AZ, nodes, duration, tcp flags, etc.).',
    '',
    'Examples (not exhaustive):',
    '- topTalkersByBytes: prefer topSrcDisplayNames in prose when set; includeDistinctPods only for pod cardinality.',
    '- namespaceTrafficMatrix: compare internal vs external bytes by namespace.',
    '- egressBytesVsBaseline vs egressSpikeDrilldown: table-only baseline vs per-source top destinations ' +
      'in one call.',
    '- topServiceFanIn / topFanOut / topDestinationWorkloadsByBytes / topConversations5Tuple for ' +
      'drill-downs.',
  ];
}

function troubleshootingSteeringPlaybook(): string[] {
  return [
    'Flow-helpful vs flow-not-helpful steering for classic troubleshooting:',
    '- BGP flaps/NOTIFICATION: flows can show TCP/179 volume/resets (limited); ' +
      'NOTIFICATION sender/code needs router logs/BMP/pcap.',
    '- OSPF EXSTART: flows can show proto 89 present/absent (limited); ' +
      'MTU/auth/network-type root cause needs device state/logs.',
    '- MTU/PMTUD: flows may show symptoms (limited); confirmation needs pcap + ICMP frag-needed/DF/MSS ' +
      'clamp evidence.',
    '- QoS/DSCP: flows may carry TOS/DSCP (often absent); rewrite/drop location needs QoS policy counters/pcaps.',
    '- Firewall/NAT: flows show tuples and asymmetry hints; exact rule/NAT policy needs firewall logs/' +
      'session table.',
    '- Asymmetry: flows can show unidirectional symptoms; hop-by-hop proof needs traceroute/pcap/routing state.',
    '- EVPN/VXLAN: flows confirm dataplane exists; learning/advertisement root cause needs EVPN control-plane ' +
      'state.',
    '- STP: flows not helpful; needs STP logs/BPDU counters/port flap evidence.',
    '- LACP/port-channel: flows rarely helpful; member state/hash needs LACP + interface state.',
    '- Multicast: flows often not helpful; needs IGMP/PIM/RPF control-plane state.',
    '- IPv6 LAN ok/internet fail: flows may show v6 egress attempts; root cause needs RA/DHCPv6/default-route/' +
      'firewall state.',
    '- DNS issues: flows show 53 patterns/timeouts; definitive cause needs DNS logs/pcap.',
    '- Wireless roaming: flows very limited; needs WLC/AP logs + RF telemetry.',
    '- Microbursts: flows not microburst-proof; needs queue drops/telemetry/buffer stats.',
    '- Segmentation: flows show attempted communications; exact policy block needs policy logs.',
  ];
}

function troubleshootingFlowStub(): string[] {
  return [
    '',
    'Flow data (supporting evidence only):',
    '- Pick tools by name from available_tools in the context JSON; args and limits are in each tool ' +
      'description.',
    `- Default to a ${DEFAULT_AGENT_MINUTES_BACK}m window unless the user specifies otherwise.`,
    '- Use aggregates for workloads and traffic patterns; use searchFlows only for a narrow slice.',
  ];
}

function generalChatPlaybook(): string[] {
  return [
    'Meta/help: no flow playbook; use tools only if asked (flows, kbSearch, mcpToolCall).',
  ];
}

function buildAgentPromptPlaybooks(intent: AgentIntent): string[] {
  if (intent === 'FLOW_ANALYTICS') return flowPlaybooksCompressed();
  if (intent === 'TROUBLESHOOTING') return [...troubleshootingSteeringPlaybook(), ...troubleshootingFlowStub()];
  if (intent === 'GENERAL_CHAT') return generalChatPlaybook();
  const _exhaustive: never = intent;
  return _exhaustive;
}
