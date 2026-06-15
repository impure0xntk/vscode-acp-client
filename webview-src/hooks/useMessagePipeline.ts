import { useRef, useMemo, useEffect } from "react";
import type { PipelineContext, PipelineItem, RawMessage } from "../pipeline";
import { createDefaultPipeline } from "../pipeline";

interface PipelineEntry {
  pipeline: import("../pipeline").MessagePipeline;
  /** Number of raw messages already processed into the pipeline */
  processedRawCount: number;
  /** Reference count: number of mounted consumers */
  refCount: number;
}

/**
 * Maximum number of session pipelines to keep in memory.
 * When exceeded, the least recently used entry (with refCount === 0) is evicted.
 */
const MAX_PIPELINE_CACHE_SIZE = 10;

/**
 * Global pipeline cache keyed by sessionKey.
 * Survives session switches so that groupKey context is preserved.
 */
const pipelineCache = new Map<string, PipelineEntry>();

/** LRU tracking: most recently used at the end */
const pipelineAccessOrder: string[] = [];

function touchAccessOrder(sessionKey: string): void {
  const idx = pipelineAccessOrder.indexOf(sessionKey);
  if (idx !== -1) {
    pipelineAccessOrder.splice(idx, 1);
  }
  pipelineAccessOrder.push(sessionKey);
}

function evictIfNeeded(): void {
  // Only evict entries with no active consumers (refCount === 0)
  while (pipelineCache.size > MAX_PIPELINE_CACHE_SIZE) {
    // Find the oldest entry with refCount === 0
    let victim: string | undefined;
    for (const key of pipelineAccessOrder) {
      const entry = pipelineCache.get(key);
      if (entry && entry.refCount === 0) {
        victim = key;
        break;
      }
    }
    if (victim) {
      pipelineCache.delete(victim);
      const idx = pipelineAccessOrder.indexOf(victim);
      if (idx !== -1) {
        pipelineAccessOrder.splice(idx, 1);
      }
    } else {
      // All entries are in use; stop evicting to avoid breaking active sessions
      break;
    }
  }
}

function getOrCreatePipeline(sessionKey: string): PipelineEntry {
  let entry = pipelineCache.get(sessionKey);
  if (!entry) {
    entry = {
      pipeline: createDefaultPipeline(),
      processedRawCount: 0,
      refCount: 0,
    };
    pipelineCache.set(sessionKey, entry);
    evictIfNeeded();
  }
  touchAccessOrder(sessionKey);
  return entry;
}

/**
 * Remove a pipeline from the cache (e.g. when a session is closed).
 * Unlike LRU eviction, this is immediate and unconditional.
 */
export function removePipelineCache(sessionKey: string): void {
  pipelineCache.delete(sessionKey);
  const idx = pipelineAccessOrder.indexOf(sessionKey);
  if (idx !== -1) {
    pipelineAccessOrder.splice(idx, 1);
  }
}

/**
 * Clear the entire pipeline cache (e.g. on extension disconnect).
 */
export function clearPipelineCache(): void {
  pipelineCache.clear();
  pipelineAccessOrder.length = 0;
}

/**
 * Process raw messages into PipelineItem[] using the pipeline.
 * Pipeline instances are preserved across session switches to maintain
 * groupKey context for consecutive message header merging.
 *
 * Reference counting ensures pipelines are only evicted when no consumers
 * are mounted, preventing cache invalidation during session switches.
 */
export function useMessagePipeline(
  rawMessages: RawMessage[],
  sessionId: string,
  agentId: string,
): PipelineItem[] {
  const sessionKey = `${agentId}:${sessionId}`;

  // Get or create pipeline for this session (preserved across switches)
  const entry = getOrCreatePipeline(sessionKey);
  const { pipeline, processedRawCount } = entry;

  // Reference counting: increment on mount, decrement on unmount
  useEffect(() => {
    entry.refCount++;
    return () => {
      entry.refCount--;
    };
  }, [entry]);

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
      entry.processedRawCount = rawMessages.length;
      return result;
    }

    // All messages already processed
    if (rawMessages.length === processedRawCount) {
      return pipeline.cached;
    }

    // Process only new messages
    const newMessages = rawMessages.slice(processedRawCount);
    const result = pipeline.processIncremental(newMessages, ctx);
    entry.processedRawCount = rawMessages.length;
    return result;
  }, [rawMessages, pipeline, sessionId, agentId, processedRawCount, entry]);
}
