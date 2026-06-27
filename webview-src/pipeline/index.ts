// Types
export type {
  RawMessage,
  ClassifiedMessage,
  SystemKind,
  ResolvedToolCall,
  ResolvedAttachment,
  ChatDisplayItem,
  CompressionDisplayItem,
  ModeChangeDisplayItem,
  ErrorNoticeDisplayItem,
  CustomSystemDisplayItem,
  PipelineItem,
  IntermediateStep,
  PipelineContext,
  FilterConfig,
  MergeConfig,
  AnnotateConfig,
  PipelineConfig,
} from "./types";

// Stages
export { classifyMessage } from "./stages/classify";
export { filterMessages } from "./stages/filter";
export { mergeToolBatches, ToolMergeStrategy, deduplicateToolCalls } from "./stages/merge";
export { annotateMessages } from "./stages/annotate";
export {
  IntermediateStepGrouper,
  selectFinalResponse,
  splitIntoSteps,
  splitLatestSteps,
} from "./stages/grouping";
export type {
  FinalResponse,
  AgentResponseGroup,
  GroupedItems,
} from "./stages/grouping";

// Pipeline
export { MessagePipeline } from "./pipeline";

// Factory
export {
  createDefaultPipeline,
  createPipeline,
  DEFAULT_CONFIG,
} from "./factory";
