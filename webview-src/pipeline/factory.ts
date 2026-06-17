import { MessagePipeline } from "./pipeline";
import type { PipelineConfig } from "./types";

/**
 * Default pipeline config — all features enabled, no filtering.
 */
export const DEFAULT_CONFIG: PipelineConfig = {
  filter: {
    hideCompression: false,
    hideModeChange: false,
    hideErrorNotices: false,
  },
  merge: {
    enabled: true,
    maxGap: 10,
  },
  annotate: {
    resolveAttachments: true,
  },
};

/**
 * Create a pipeline with default config.
 */
export function createDefaultPipeline(): MessagePipeline {
  return new MessagePipeline(DEFAULT_CONFIG);
}

/**
 * Create a pipeline with custom config.
 */
export function createPipeline(config: PipelineConfig): MessagePipeline {
  return new MessagePipeline(config);
}
