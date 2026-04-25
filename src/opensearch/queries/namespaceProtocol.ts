import type { FieldPreference } from '../fieldCaps.js';
import type { SearchClient } from '../../search/types.js';
import { externalDestinationIpBool, internalDestinationIpBool } from './destinationIp.js';
import { getBuckets, timedSearch, toNumber, toString, type AggBucket, type AggValue } from './shared.js';

export type NamespaceTrafficMatrixRow = {
  namespace: string;
  internalBytes: number;
  externalBytes: number;
  internalFlows: number;
  externalFlows: number;
};

/** Per client namespace: bytes and flow counts to internal vs external destination IPs. */
export async function queryNamespaceTrafficMatrix(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  minutesBack: number;
  namespaceTermsSize: number;
}): Promise<NamespaceTrafficMatrixRow[]> {
  if (!opts.fields.clientNamespaceField) return [];

  const { body } = (await timedSearch('queryNamespaceTrafficMatrix', opts.client, {
    index: opts.index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { '@timestamp': { gte: `now-${opts.minutesBack}m`, lt: 'now' } } }],
        },
      },
      aggs: {
        by_ns: {
          terms: { field: opts.fields.clientNamespaceField, size: opts.namespaceTermsSize },
          aggs: {
            internal: {
              filter: internalDestinationIpBool(opts.fields.dstIpField) as never,
              aggs: { sum_bytes: { sum: { field: opts.fields.bytesField } } },
            },
            external: {
              filter: externalDestinationIpBool(opts.fields.dstIpField) as never,
              aggs: { sum_bytes: { sum: { field: opts.fields.bytesField } } },
            },
          },
        },
      },
    } as never,
  })) as { body: unknown };

  return getBuckets(body as unknown, ['aggregations', 'by_ns', 'buckets']).map((b) => {
    const intB = b['internal'] as AggBucket | undefined;
    const extB = b['external'] as AggBucket | undefined;
    const intSum = intB?.['sum_bytes'] as AggValue | undefined;
    const extSum = extB?.['sum_bytes'] as AggValue | undefined;
    return {
      namespace: toString(b.key),
      internalBytes: toNumber(intSum?.value),
      externalBytes: toNumber(extSum?.value),
      internalFlows: toNumber(intB?.['doc_count']),
      externalFlows: toNumber(extB?.['doc_count']),
    };
  });
}

export type ProtocolNamespaceRow = {
  protocol: string;
  namespace: string;
  bytes: number;
  flows: number;
};

/** Bytes and doc_count per protocol x client namespace. */
export async function queryProtocolNamespaceRollup(opts: {
  client: SearchClient;
  index: string;
  fields: FieldPreference;
  minutesBack: number;
  protoTermsSize: number;
  nsTermsSize: number;
}): Promise<ProtocolNamespaceRow[]> {
  if (!opts.fields.clientNamespaceField || !opts.fields.protoField) return [];

  const { body } = (await timedSearch('queryProtocolNamespaceRollup', opts.client, {
    index: opts.index,
    size: 0,
    body: {
      query: {
        bool: {
          filter: [{ range: { '@timestamp': { gte: `now-${opts.minutesBack}m`, lt: 'now' } } }],
        },
      },
      aggs: {
        by_proto: {
          terms: { field: opts.fields.protoField, size: opts.protoTermsSize },
          aggs: {
            by_ns: {
              terms: { field: opts.fields.clientNamespaceField, size: opts.nsTermsSize },
              aggs: {
                sum_bytes: { sum: { field: opts.fields.bytesField } },
              },
            },
          },
        },
      },
    } as never,
  })) as { body: unknown };

  const protoBuckets = getBuckets(body as unknown, ['aggregations', 'by_proto', 'buckets']);
  return protoBuckets.flatMap((pb) => {
    const proto = toString(pb.key);
    const nsBuckets = getBuckets(pb, ['by_ns', 'buckets']);
    return nsBuckets.map((nb) => {
      const sumB = nb['sum_bytes'] as AggValue | undefined;
      return {
        protocol: proto,
        namespace: toString(nb.key),
        bytes: toNumber(sumB?.value),
        flows: toNumber(nb['doc_count']),
      };
    });
  });
}
