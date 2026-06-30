import type {
  ClassifiedMessage,
  PipelineConfig,
  PipelineContext,
  PipelineItem,
  RawMessage,
} from "./types";
import { classifyMessage } from "./stages/classify";
import { filterMessages } from "./stages/filter";
import { annotateMessages } from "./stages/annotate";

/**
 * Message pipeline that processes raw messages into PipelineItem[].
 * Pipeline: classify → filter → annotate
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
    ctx: PipelineContext
  ): PipelineItem[] {
    if (newMessages.length === 0) return this.cache;

    const classifiedNew = newMessages.map((msg) => classifyMessage(msg));
    const filtered = filterMessages(classifiedNew, this.config.filter);
    const annotated = annotateMessages(filtered, this.config.annotate);

    this.cache = [...this.cache, ...annotated];
    return this.cache;
  }

  /**
   * Re-process the last raw message when it was updated in-place
   * (e.g. streaming chunk appended to an existing message, or
   * stopReason stamped by turnEnded).
   */
  refreshLast(rawMessages: RawMessage[], ctx: PipelineContext): PipelineItem[] {
    if (rawMessages.length === 0) {
      this.cache = [];
      return this.cache;
    }

    const lastRaw = rawMessages[rawMessages.length - 1];
    const classified = classifyMessage(lastRaw);
    const filtered = filterMessages([classified], this.config.filter);
    const annotated = annotateMessages(filtered, this.config.annotate);

    if (annotated.length > 0) {
      if (this.cache.length > 0) {
        this.cache[this.cache.length - 1] = annotated[0];
      } else {
        this.cache = annotated;
      }
    }

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
    return annotateMessages(filtered, this.config.annotate);
  }
}
