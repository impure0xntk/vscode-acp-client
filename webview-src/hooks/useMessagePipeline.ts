import { useRef, useMemo } from "react";
import type { PipelineContext, PipelineItem, RawMessage } from "../pipeline";
import { createDefaultPipeline } from "../pipeline";

interface PipelineCache {
  pipeline: import("../pipeline").MessagePipeline;
  sessionKey: string | null;
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
  });

  const sessionKey = `${agentId}:${sessionId}`;
  if (cacheRef.current.sessionKey !== sessionKey) {
    cacheRef.current = {
      pipeline: createDefaultPipeline(),
      sessionKey,
    };
  }

  const { pipeline } = cacheRef.current;

  return useMemo(() => {
    const ctx: PipelineContext = {
      sessionId,
      agentId,
      sessionCwd: undefined,
      existingItems: pipeline.cached,
    };

    if (pipeline.cached.length === 0) {
      return pipeline.process(rawMessages, ctx);
    }

    const newMessages = rawMessages.slice(
      // Count only "chat" items for raw message indexing
      // Non-chat items (compression, etc.) don't correspond 1:1 with raw messages
      pipeline.cached.filter((i) => i.type === "chat").length,
    );
    return pipeline.processIncremental(newMessages, ctx);
  }, [rawMessages, pipeline, sessionId, agentId]);
}
