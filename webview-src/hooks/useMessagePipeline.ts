import { useRef, useMemo } from "react";
import type { PipelineContext, PipelineItem, RawMessage } from "../pipeline";
import { createDefaultPipeline } from "../pipeline";

interface PipelineCache {
  pipeline: import("../pipeline").MessagePipeline;
  sessionKey: string | null;
  /** Number of raw messages already processed into the pipeline */
  processedRawCount: number;
}

/**
 * Process raw messages into PipelineItem[] using the pipeline.
 * Creates a new pipeline instance on session switch; reuses across renders.
 */
export function useMessagePipeline(
  rawMessages: RawMessage[],
  sessionId: string,
  agentId: string,
): PipelineItem[] {
  const cacheRef = useRef<PipelineCache>({
    pipeline: createDefaultPipeline(),
    sessionKey: null,
    processedRawCount: 0,
  });

  const sessionKey = `${agentId}:${sessionId}`;

  // Session switch: always reset when sessionKey changes
  if (cacheRef.current.sessionKey !== sessionKey) {
    cacheRef.current = {
      pipeline: createDefaultPipeline(),
      sessionKey,
      processedRawCount: 0,
    };
  }

  const { pipeline, processedRawCount } = cacheRef.current;

  return useMemo(() => {
    const ctx: PipelineContext = {
      sessionId,
      agentId,
      sessionCwd: undefined,
      existingItems: pipeline.cached,
    };

    // First render for this session or empty pipeline
    if (pipeline.cached.length === 0 || rawMessages.length < processedRawCount) {
      // Reset if we have fewer messages than processed (e.g. session reset)
      const result = pipeline.process(rawMessages, ctx);
      cacheRef.current.processedRawCount = rawMessages.length;
      return result;
    }

    // All messages already processed
    if (rawMessages.length === processedRawCount) {
      return pipeline.cached;
    }

    // Process only new messages
    const newMessages = rawMessages.slice(processedRawCount);
    const result = pipeline.processIncremental(newMessages, ctx);
    cacheRef.current.processedRawCount = rawMessages.length;
    return result;
  }, [rawMessages, pipeline, sessionId, agentId, processedRawCount]);
}
