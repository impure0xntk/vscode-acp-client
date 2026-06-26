import { useRef, useMemo, useEffect } from "react";
import type { PipelineContext, PipelineItem, RawMessage } from "../pipeline";
import { createDefaultPipeline } from "../pipeline";

interface PipelineEntry {
  pipeline: import("../pipeline").MessagePipeline;
  /** Number of raw messages already processed into the pipeline */
  processedRawCount: number;
  /**
   * Hash of mutable fields across ALL raw messages.
   * In-place updates (streaming chunk append via appendStreamChunk, or
   * stopReason stamp via updateLastAgentMessage) change message content
   * without changing the array length. When this hash changes but the
   * count doesn't, the entire pipeline is re-processed from scratch to
   * pick up the updated content/stopReason in the correct messages.
   */
  contentHash: string;
  /** Reference count: number of mounted consumers */
  refCount: number;
}

/**
 * Compute a fast hash of mutable fields across all raw messages.
 * Detects in-place mutations (streaming content append, stopReason stamp,
 * toolCalls insertion/update) that don't change the array length.
 */
function computeContentHash(msgs: RawMessage[]): string {
  let hash = msgs.length.toString(36) + ":";
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] as unknown as Record<string, unknown>;
    hash +=
      (typeof m.content === "string" ? m.content.length : 0).toString(36) +
      ";";
    if (m.stopReason !== undefined && m.stopReason !== null) {
      hash += String(m.stopReason) + ";";
    }
    // Include toolCalls so in-place updates (e.g. handleSessionNotification
    // calling updateMessage to append/update tool calls) are detected.
    const tcs = m.toolCalls as unknown[] | undefined;
    if (tcs && tcs.length > 0) {
      hash += tcs.length.toString(36) + ":";
      for (let j = 0; j < tcs.length; j++) {
        const tc = tcs[j] as Record<string, unknown>;
        hash += (tc.id ?? "") + ":" + (tc.status ?? "") + ";";
      }
    }
  }
  return hash;
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
      contentHash: "",
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
 * Deduplicate raw messages by id, preserving insertion order.
 * When the same message id appears multiple times (e.g. session/notification
 * tool_call + session/message delivering the same tool message), keep the
 * latest version (last occurrence) so it has the most up-to-date content,
 * toolCalls, and stopReason.
 */
function deduplicateRawMessages(msgs: RawMessage[]): RawMessage[] {
  const byId = new Map<string, RawMessage>();
  for (const msg of msgs) {
    const id = msg.id ?? (msg.timestamp != null ? String(msg.timestamp) : "");
    if (id) {
      byId.set(id, msg);
    } else {
      // Messages without id or timestamp cannot be deduplicated —
      // use a unique key so they are always kept.
      byId.set(`__no-id-${byId.size}`, msg);
    }
  }
  // Preserve original order: iterate original array, keep only the last
  // occurrence of each id.
  const seen = new Set<string>();
  const result: RawMessage[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    const id = msg.id ?? (msg.timestamp != null ? String(msg.timestamp) : "");
    const dedupId = id || `__no-id-${i}`;
    if (!seen.has(dedupId)) {
      seen.add(dedupId);
      result.unshift(byId.get(dedupId)!);
    }
  }
  return result;
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
  agentId: string
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

  // Deduplicate raw messages to prevent duplicate keys in the pipeline output.
  // This handles the case where session/notification and session/message both
  // deliver the same tool message (same id), which would produce two
  // PipelineItems with the same key after merge promotion.
  const dedupedMessages = useMemo(
    () => deduplicateRawMessages(rawMessages),
    [rawMessages]
  );

  return useMemo(() => {
    const ctx: PipelineContext = {
      sessionId,
      agentId,
      sessionCwd: undefined,
      existingItems: pipeline.cached,
    };

    // First render for this session or empty pipeline
    if (
      pipeline.cached.length === 0 ||
      dedupedMessages.length < processedRawCount
    ) {
      // Reset if we have fewer messages than processed (e.g. session reset)
      const result = pipeline.process(dedupedMessages, ctx);
      entry.processedRawCount = dedupedMessages.length;
      entry.contentHash =
        dedupedMessages.length > 0
          ? computeContentHash(dedupedMessages)
          : "";
      return result;
    }

    // In-place update detection: when the message count hasn't changed
    // but mutable fields (content, stopReason) have been modified across
    // ANY message (not just the last), the pipeline cache is stale.
    // Fall through to a full re-process so that all annotations are
    // refreshed — the incremental codepath can't handle cross-message
    // content mutations (e.g. appendStreamChunk mutates a message that
    // is not at the end of the array when tool messages follow it).
    if (dedupedMessages.length === processedRawCount) {
      if (dedupedMessages.length > 0) {
        const currentHash = computeContentHash(dedupedMessages);
        if (currentHash !== entry.contentHash) {
          entry.contentHash = currentHash;
          const result = pipeline.process(dedupedMessages, ctx);
          entry.processedRawCount = dedupedMessages.length;
          return result;
        }
      }
      return pipeline.cached;
    }

    // Process only new messages
    const newMessages = dedupedMessages.slice(processedRawCount);
    const result = pipeline.processIncremental(newMessages, ctx);
    entry.processedRawCount = dedupedMessages.length;
    entry.contentHash =
      dedupedMessages.length > 0
        ? computeContentHash(dedupedMessages)
        : "";
    return result;
  }, [dedupedMessages, pipeline, sessionId, agentId, processedRawCount, entry]);
}
