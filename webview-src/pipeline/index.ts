// Types
export type {
  RawMessage,
  ClassifiedMessage,
  SystemKind,
  ResolvedToolCall,
  ResolvedAttachment,
  RenderContext,
  ChatDisplayItem,
  CompressionDisplayItem,
  ModeChangeDisplayItem,
  ErrorNoticeDisplayItem,
  CustomSystemDisplayItem,
  PipelineItem,
  PipelineContext,
  FilterConfig,
  MergeConfig,
  AnnotateConfig,
  PipelineConfig,
} from "./types";

// Stages
export { classifyMessage } from "./stages/classify";
export { filterMessages } from "./stages/filter";
export { mergeToolBatches } from "./stages/merge";
export { annotateMessages } from "./stages/annotate";

// Pipeline
export { MessagePipeline } from "./pipeline";

// Factory
export { createDefaultPipeline, createPipeline, DEFAULT_CONFIG } from "./factory";
