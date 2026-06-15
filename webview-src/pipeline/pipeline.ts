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

    // Merge — combine cached (as classified) with new filtered items
    const cachedClassified: ClassifiedMessage[] = this.cache.map((item) => {
      // Reconstruct minimal ClassifiedMessage from cached PipelineItem
      // Only "chat" items participate in merge; others pass through
      if (item.type === "chat") {
        return {
          id: item.key,
          role: item.role,
          content: item.content,
          timestamp: item.timestamp ?? 0,
          systemKind: "info" as const,
          toolCalls: item.resolvedToolCalls,
        } satisfies ClassifiedMessage;
      }
      // Non-chat items (compression, etc.) — not subject to merge
      return {
        id: item.key,
        role: "system" as const,
        content: "",
        timestamp: item.timestamp ?? 0,
        systemKind: item.type,
      } satisfies ClassifiedMessage;
    });

    const merged = this.config.merge.enabled
      ? mergeToolBatches([...cachedClassified, ...filtered], this.config.merge)
      : [...cachedClassified, ...filtered];

    // Annotate only the new tail (items beyond cache length)
    const newTail = merged.slice(this.cache.length);
    const annotated = annotateMessages(newTail, this.config.annotate);

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
