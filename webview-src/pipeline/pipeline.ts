import type {
  ClassifiedMessage,
  PipelineConfig,
  PipelineContext,
  PipelineItem,
  RawMessage,
} from "./types";
import type { ToolCall } from "../types";
import { classifyMessage } from "./stages/classify";
import { filterMessages } from "./stages/filter";
import { ToolMergeStrategy } from "./stages/merge";
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
    ctx: PipelineContext
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
      const lastCached =
        this.cache.length > 0 ? this.cache[this.cache.length - 1] : null;
      const contextPrefix: ClassifiedMessage[] = lastCached
        ? [
            {
              id: lastCached.key,
              role:
                lastCached.type === "chat"
                  ? lastCached.role
                  : ("system" as const),
              content: lastCached.type === "chat" ? lastCached.content : "",
              timestamp: lastCached.timestamp ?? 0,
              agentId:
                lastCached.type === "chat" ? lastCached.agentId : undefined,
              systemKind:
                lastCached.type === "chat"
                  ? ("info" as const)
                  : (lastCached.type as ClassifiedMessage["systemKind"]),
              toolCalls:
                lastCached.type === "chat"
                  ? (lastCached.resolvedToolCalls as unknown as ToolCall[])
                  : undefined,
            } satisfies ClassifiedMessage,
          ]
        : [];

      const merged = new ToolMergeStrategy().merge(
        [...contextPrefix, ...filtered],
        this.config.merge
      );

      // Check if the contextPrefix was modified by merge.
      // When a tool message is absorbed into the contextPrefix agent, the merged
      // result contains the updated agent with combined toolCalls. We must update
      // the cache's last item accordingly — otherwise tool calls are silently lost.
      if (contextPrefix.length > 0 && merged.length > 0) {
        const originalTCs = contextPrefix[0].toolCalls;
        const mergedTCs = merged[0].toolCalls;
        // Reference comparison: if merge absorbed tool calls into the contextPrefix
        // element, the toolCalls array reference will differ (deduplicateToolCalls
        // always returns a new array when new calls are added).
        if (mergedTCs !== originalTCs && mergedTCs != null) {
          // Re-annotate the merged first element and update cache's last item.
          const reannotated = annotateMessages(
            [merged[0]],
            this.config.annotate
          );
          if (reannotated.length > 0) {
            this.cache[this.cache.length - 1] = reannotated[0];
            // Return a new array reference so React re-renders.
            // Without this, the tool calls absorbed into the last cached
            // item are invisible because React sees the same array ref.
            return [...this.cache];
          }
        }
      }

      // Drop the context prefix — it was only needed for merge context
      mergedNew = merged.slice(contextPrefix.length);
    } else {
      mergedNew = filtered;
    }

    // Annotate the merged new items.
    // Turn-start detection (isFirstOfTurn) is handled entirely within
    // annotateMessages based on __stepBoundary flags and the preceding
    // item's role (user/system → next agent/tool shows header).
    const annotated = annotateMessages(
      mergedNew,
      this.config.annotate
    );

    this.cache = [...this.cache, ...annotated];
    return this.cache;
  }

  /**
   * Re-process the last raw message when it was updated in-place
   * (e.g. streaming chunk appended to an existing message, or
   * stopReason stamped by turnEnded).
   *
   * This avoids a full cache-clear (which would lose groupKey context)
   * while still reflecting the latest content/metadata in the cache.
   */
  refreshLast(
    rawMessages: RawMessage[],
    ctx: PipelineContext
  ): PipelineItem[] {
    if (rawMessages.length === 0) {
      this.cache = [];
      return this.cache;
    }

    // Only re-process the last raw message.  Everything else is still
    // valid — we just need to replace the last cached PipelineItem
    // with fresh annotation from the updated raw message.
    const lastRaw = rawMessages[rawMessages.length - 1];
    const classified = classifyMessage(lastRaw);
    const filtered = filterMessages([classified], this.config.filter);

    // Merge with the preceding cached item (if any) for cross-boundary
    // tool deduplication.
    let merged: ClassifiedMessage[];
    if (this.config.merge.enabled && this.cache.length > 0) {
      const lastCached = this.cache[this.cache.length - 1];
      const contextPrefix: ClassifiedMessage[] = [
        {
          id: lastCached.key,
          role:
            lastCached.type === "chat"
              ? lastCached.role
              : ("system" as const),
          content: lastCached.type === "chat" ? lastCached.content : "",
          timestamp: lastCached.timestamp ?? 0,
          agentId:
            lastCached.type === "chat" ? lastCached.agentId : undefined,
          systemKind:
            lastCached.type === "chat"
              ? ("info" as const)
              : (lastCached.type as ClassifiedMessage["systemKind"]),
          toolCalls:
            lastCached.type === "chat"
              ? (lastCached.resolvedToolCalls as unknown as ToolCall[])
              : undefined,
        } satisfies ClassifiedMessage,
      ];
      merged = new ToolMergeStrategy().merge(
        [...contextPrefix, ...filtered],
        this.config.merge
      );

      // Check if the contextPrefix was modified by merge.
      // If so, the preceding cached item absorbed tool calls from the
      // re-processed message — update it in the cache.
      if (contextPrefix.length > 0 && merged.length > 0) {
        const originalTCs = contextPrefix[0].toolCalls;
        const mergedTCs = merged[0].toolCalls;
        if (mergedTCs !== originalTCs && mergedTCs != null) {
          const reannotated = annotateMessages(
            [merged[0]],
            this.config.annotate
          );
          if (reannotated.length > 0) {
            this.cache[this.cache.length - 1] = reannotated[0];
            // Return a new array reference so React re-renders.
            return [...this.cache];
          }
        }
      }

      // Drop the contextPrefix — it was only needed for merge context
      merged = merged.slice(contextPrefix.length);
    } else {
      merged = filtered;
    }

    // Annotate the new/changed message.
    // Turn-start detection is handled within annotateMessages.
    const annotated = annotateMessages(
      merged,
      this.config.annotate
    );

    if (annotated.length > 0) {
      if (this.cache.length > 0) {
        this.cache[this.cache.length - 1] = annotated[0];
      } else {
        this.cache = annotated;
      }
    }

    // Return a new array reference so React re-renders
    return [...this.cache];
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

  private runStages(
    messages: RawMessage[],
    ctx: PipelineContext
  ): PipelineItem[] {
    const classified: ClassifiedMessage[] = messages.map((msg) =>
      classifyMessage(msg)
    );
    const filtered = filterMessages(classified, this.config.filter);
    const merged = this.config.merge.enabled
      ? new ToolMergeStrategy().merge(filtered, this.config.merge)
      : filtered;
    return annotateMessages(merged, this.config.annotate);
  }
}
