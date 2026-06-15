import type {
  ClassifiedMessage,
  PipelineConfig,
  PipelineContext,
  PipelineItem,
  RawMessage,
} from "./types";
import { classifyMessage } from "./stages/classify";
import { filterMessages } from "./stages/filter";
import { mergeToolBatches } from "./stages/merge";
import { annotateMessages } from "./stages/annotate";

/**
 * Message pipeline that processes raw messages into PipelineItem[].
 * Supports incremental processing to avoid re-processing cached items.
 */
export class MessagePipeline {
  private cache: PipelineItem[] = [];

  constructor(private config: PipelineConfig) {}

  /**
   * Process all messages from scratch (first render).
   */
  process(messages: RawMessage[], ctx: PipelineContext): PipelineItem[] {
    const result = this.runStages(messages, ctx);
    this.cache = result;
    return this.cache;
  }

  /**
   * Process only new messages and append to cache (incremental).
   *
   * The cache already contains fully-merged PipelineItems, so we must NOT
   * re-merge them — doing so would duplicate toolCalls across items.
   * Instead we merge only the new messages, using the last cached item
   * as context for cross-boundary tool merging.
   */
  processIncremental(
    newMessages: RawMessage[],
    ctx: PipelineContext,
  ): PipelineItem[] {
    if (newMessages.length === 0) return this.cache;

    // Classify new messages
    const classifiedNew = newMessages.map((msg) => classifyMessage(msg));

    // Filter
    const filtered = filterMessages(classifiedNew, this.config.filter);

    // Merge only the new messages.
    // If merge is enabled, we need to consider the last cached item as
    // context so that a tool message following a cached agent message
    // is correctly merged across the boundary.
    let mergedNew: ClassifiedMessage[];
    if (this.config.merge.enabled) {
      // Build a minimal context from the last cached item (if any)
      // so mergeToolBatches can see the preceding agent/tool state.
      const lastCached = this.cache.length > 0 ? this.cache[this.cache.length - 1] : null;
      const contextPrefix: ClassifiedMessage[] = lastCached
        ? [
            {
              id: lastCached.key,
              role:
                lastCached.type === "chat"
                  ? lastCached.role
                  : ("system" as const),
              content:
                lastCached.type === "chat" ? lastCached.content : "",
              timestamp: lastCached.timestamp ?? 0,
              systemKind:
                lastCached.type === "chat"
                  ? ("info" as const)
                  : (lastCached.type as ClassifiedMessage["systemKind"]),
              toolCalls:
                lastCached.type === "chat"
                  ? lastCached.resolvedToolCalls
                  : undefined,
            } satisfies ClassifiedMessage,
          ]
        : [];

      const merged = mergeToolBatches(
        [...contextPrefix, ...filtered],
        this.config.merge,
      );
      // Drop the context prefix — it was only needed for merge context
      mergedNew = merged.slice(contextPrefix.length);
    } else {
      mergedNew = filtered;
    }

    // Annotate the merged new items, carrying over group-key context
    // from the last cached item so isConsecutive is computed correctly
    // across the cache boundary.
    const lastCached =
      this.cache.length > 0 ? this.cache[this.cache.length - 1] : null;
    const lastGroupKey =
      lastCached && lastCached.type === "chat" ? lastCached.groupKey : "";
    const annotated = annotateMessages(
      mergedNew,
      this.config.annotate,
      lastGroupKey,
    );

    this.cache = [...this.cache, ...annotated];
    return this.cache;
  }

  /**
   * Clear the internal cache (e.g. on session switch).
   */
  clear(): void {
    this.cache = [];
  }

  /**
   * Update pipeline config and clear cache.
   */
  updateConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config };
    this.clear();
  }

  /** Current cached pipeline items */
  get cached(): PipelineItem[] {
    return this.cache;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private runStages(messages: RawMessage[], ctx: PipelineContext): PipelineItem[] {
    // 1. Classify
    const classified: ClassifiedMessage[] = messages.map((msg) => classifyMessage(msg));

    // 2. Filter
    const filtered = filterMessages(classified, this.config.filter);

    // 3. Merge
    const merged = this.config.merge.enabled
      ? mergeToolBatches(filtered, this.config.merge)
      : filtered;

    // 4. Annotate — returns PipelineItem[]
    return annotateMessages(merged, this.config.annotate);
  }
}
