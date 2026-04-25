import type { FieldPreference } from '../../src/opensearch/fieldCaps.js';

/** Shared ElastiFlow-style field map for unit tests. */
export const DEFAULT_TEST_FLOW_FIELDS: FieldPreference = {
  bytesField: 'flow.bytes',
  srcIpField: 'flow.client.ip.addr',
  dstIpField: 'flow.server.ip.addr',
  srcPortField: 'flow.client.port',
  dstPortField: 'flow.server.port',
  protoField: 'l4.proto.name',
};
