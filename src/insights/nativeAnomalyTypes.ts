export type NativeAnomalyPipelineResult = {
  ok: boolean;
  hasScopedSources: boolean;
  opensearch?: { detectorIds: string[] };
  elasticsearch?: { jobIds: string[] };
  warning?: string;
};
