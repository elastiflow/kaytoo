import type { SearchClient } from '../../../search/types.js';

export async function pickAggregatableField({
  client,
  index,
  field,
}: {
  client: SearchClient;
  index: string;
  field: string | undefined;
}): Promise<string | undefined> {
  if (!field) return undefined;
  const keyword = `${field}.keyword`;
  const resp = await client.fieldCaps({
    index,
    fields: [field, keyword],
    ignore_unavailable: true,
    allow_no_indices: true,
  });
  const caps = (resp.body as { fields?: Record<string, unknown> }).fields ?? {};

  const aggregatable = (f: string): boolean => {
    const entry = caps[f];
    if (!entry || typeof entry !== 'object') return false;
    return Object.values(entry as Record<string, unknown>).some((t) => {
      if (!t || typeof t !== 'object') return false;
      return (t as { aggregatable?: unknown }).aggregatable === true;
    });
  };

  if (aggregatable(field)) return field;
  if (aggregatable(keyword)) return keyword;
  return undefined;
}
