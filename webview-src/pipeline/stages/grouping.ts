import type { ChatDisplayItem, FileEditEntry, IntermediateStep, PipelineItem } from "../types";
import { useFileWriteStore } from "../../store/fileWriteStore";
import type { FileWriteRecord } from "../../store/fileWriteStore";
import { getLogger } from "../../lib/logger";

const log = getLogger("pipeline.grouping");

export interface FinalResponse {
  item: PipelineItem;
  index: number;
}

export interface AgentResponseGroup {
  userItem: PipelineItem;
  steps: IntermediateStep[];
  finalResponse: FinalResponse | null;
  /**
   * The latest visible step outside the banner: final response + subsequent
   * tool calls.  When non-null, this step is rendered via <StepView> instead
   * of folding into the banner.  Set when tool calls follow the final
   * response so they are correctly attributed to the final step, not a
   * preceding intermediate step.
   */
  currentStep: IntermediateStep | null;
  /** All file edits in this turn, merged across steps — shown below final response */
  turnFileEditSummary?: FileEditEntry[];
  /**
   * Non-chat/non-tool items that appear between the previous user message
   * and this group's user message (compression, mode_change, error_notice,
   * custom). These are rendered before the user message to preserve
   * chronological order without being dropped by splitIntoSteps.
   */
  passthrough: PipelineItem[];
}

export interface GroupedItems {
  /** Items before the first user message (system notices, etc.) */
  leading: PipelineItem[];
  groups: AgentResponseGroup[];
  latestGroup: AgentResponseGroup | null;
  trailing: PipelineItem[];
}

/**
 * Cache key for diff results.  Uses hash-based keys so that identical content
 * across different string instances (e.g. same content in separate turns)
 * hits the cache.  Short strings (< 256 chars) use value-based keys for
 * efficiency; long strings use FNV-1a hash to avoid storing huge keys.
 */
type DiffCacheKey = `${string}__${string}`;

/**
 * FNV-1a hash — fast, decent distribution for short strings.
 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function makeDiffCacheKey(a: string | null, b: string | null): DiffCacheKey {
  const hash = (s: string | null): string => {
    if (s == null) return "null";
    if (s.length < 256) return s;
    return fnv1a(s);
  };
  return `${hash(a)}__${hash(b)}`;
}

/**
 * Maximum number of entries in the diff cache.
 * When exceeded, the oldest entry is evicted (LRU).
 */
const DIFF_CACHE_MAX_SIZE = 2000;

/**
 * Module-level diff cache with LRU eviction.
 * Persists across calls within a session lifetime.
 * Keyed by hash(originalContent)__hash(writtenContent).
 */
const diffCache = new Map<DiffCacheKey, { added: number; deleted: number }>();

/**
 * Set a cache entry with LRU eviction.
 * Moves the entry to the end (most recently used).
 */
function setDiffCache(key: DiffCacheKey, value: { added: number; deleted: number }): void {
  if (diffCache.has(key)) {
    // Move to end (MRU)
    diffCache.delete(key);
    diffCache.set(key, value);
    return;
  }
  if (diffCache.size >= DIFF_CACHE_MAX_SIZE) {
    // Evict oldest (first key)
    const firstKey = diffCache.keys().next().value;
    if (firstKey != null) diffCache.delete(firstKey);
  }
  diffCache.set(key, value);
}

/**
 * Compute LCS-based line-level diff between original and new content.
 * Returns counts of added and deleted lines.
 *
 * Uses a simple LCS (Longest Common Subsequence) algorithm optimized
 * for typical file diffs where lines are mostly preserved.
 * Results are cached by content hash pair to avoid O(n\*m) recomputation.
 */
export function computeLineDiff(
  original: string | null,
  newContent: string | null,
): { added: number; deleted: number } {
  if (original === newContent) return { added: 0, deleted: 0 };

  const key = makeDiffCacheKey(original, newContent);
  const cached = diffCache.get(key);
  if (cached) return cached;

  const origLines = (original ?? "").split("\n");
  const newLines = (newContent ?? "").split("\n");

  let result: { added: number; deleted: number };

  // Handle empty cases
  if (origLines.length === 1 && origLines[0] === "" && newLines.length === 1 && newLines[0] === "") {
    result = { added: 0, deleted: 0 };
  } else if (origLines.length === 1 && origLines[0] === "") {
    // All lines are additions
    result = { added: newLines[newLines.length - 1] === "" ? newLines.length - 1 : newLines.length, deleted: 0 };
  } else if (newLines.length === 1 && newLines[0] === "") {
    // All lines are deletions
    result = { added: 0, deleted: origLines[origLines.length - 1] === "" ? origLines.length - 1 : origLines.length };
  } else {
    // LCS using dynamic programming with O(n*m) time, O(n*m) space
    const m = origLines.length;
    const n = newLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (origLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcsLength = dp[m][n];
    result = { added: n - lcsLength, deleted: m - lcsLength };
  }

  setDiffCache(key, result);
  return result;
}

/**
 * Clear the diff cache.  Kept for backward compatibility but no-op now —
 * LRU eviction handles memory management.  Only clears on full reset.
 */
export function clearDiffCache(): void {
  // No-op: LRU eviction manages cache size.  This function is kept for
  // API compatibility with existing callers (clearPipelineCache).
}

/**
 * Build a FileEditEntry[] from a slice of FileWriteRecords.
 * Multiple writes to the same path are merged (latest written content wins).
 * Original content is taken from the first write to each path.
 * Line counts are computed using cached LCS-based diff.
 */
export function buildSummaryFromWrites(writes: FileWriteRecord[]): FileEditEntry[] | undefined {
  if (writes.length === 0) return undefined;

  const seen = new Map<string, { originalContent: string | null; writtenContent: string | null }>();
  for (const w of writes) {
    const existing = seen.get(w.path);
    if (existing) {
      existing.writtenContent = w.content;
    } else {
      seen.set(w.path, { originalContent: w.originalContent, writtenContent: w.content });
    }
  }

  const result: FileEditEntry[] = [];
  for (const [path, { originalContent, writtenContent }] of seen) {
    const { added, deleted } = computeLineDiff(originalContent, writtenContent);
    result.push({
      path,
      lineCount: added,
      deletedLines: deleted,
      kind: "fs/write_text_file",
      originalContent,
      writtenContent,
    });
  }

  return result;
}

/**
 * Build a FileEditEntry[] from all fileWriteStore records for a session.
 * (Legacy — used only for tests / backward compat.)
 */
export function extractFileEditSummaryFromStore(
  agentId: string,
  sessionId: string
): FileEditEntry[] | undefined {
  const store = useFileWriteStore.getState();
  const writes = store.getWritesForSession(agentId, sessionId);
  return buildSummaryFromWrites(writes);
}

/**
 * Binary search: find first index where arr[idx].seq >= target.
 * Assumes arr is sorted by seq ascending.  O(log n).
 */
export function lowerBound(arr: FileWriteRecord[], target: number, start: number = 0): number {
  let lo = start, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].seq < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Get writes scoped to a specific turn using writeSeq boundaries.
 * A turn's writes are those with seq >= turn's first agent message writeSeq
 * and < next turn's first agent message writeSeq (or Infinity for the last turn).
 *
 * For groups with no agent messages (pre-agent steps only), lo=0.
 * For the last turn, hi=Infinity.
 */
function getWritesForTurn(
  allWrites: FileWriteRecord[],
  turnFirstWriteSeq: number,
  nextTurnFirstWriteSeq: number | null,
): FileWriteRecord[] {
  const lo = turnFirstWriteSeq;
  const hi = nextTurnFirstWriteSeq ?? Infinity;
  const startIdx = lowerBound(allWrites, lo);
  const result: FileWriteRecord[] = [];
  for (let i = startIdx; i < allWrites.length; i++) {
    if (allWrites[i].seq >= hi) break;
    result.push(allWrites[i]);
  }
  return result;
}

/**
 * Boundary for partitioning file writes among steps.
 * `writeSeq` is the file-write sequence counter stamped on the agent message
 * that begins each step.  Writes with seq in [lo, hi) belong to that step.
 */
interface WriteSeqBoundary {
  /** Inclusive lower bound of write seq for this step */
  lo: number;
  /** Exclusive upper bound (next step's lo, or Infinity for the last step) */
  hi: number;
}



/**
 * Compute write-seq boundaries for each step in a group.
 * Uses the `writeSeq` field stamped on agent messages via the
 * webview message handler (handleSessionStreamStart etc.).
 *
 * For pre-agent steps (agentMessage === null), the lower bound is 0
 * (writes before any agent message arrived).
 */
function computeWriteSeqBoundaries(steps: IntermediateStep[]): WriteSeqBoundary[] {
  const boundaries: WriteSeqBoundary[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const lo = step.agentMessage?.writeSeq ?? 0;
    boundaries.push({ lo, hi: Infinity });
  }
  // Fill in exclusive upper bounds: each step's hi = next step's lo
  for (let i = 0; i < boundaries.length - 1; i++) {
    boundaries[i].hi = boundaries[i + 1].lo;
  }
  // Collapse empty ranges: when adjacent steps share the same writeSeq,
  // the earlier step gets [lo, lo) = empty.  Expand its hi to the next
  // distinct lo so writes are attributed to the step that was active.
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (boundaries[i].lo === boundaries[i].hi) {
      for (let j = i + 1; j < boundaries.length; j++) {
        if (boundaries[j].lo > boundaries[i].lo) {
          boundaries[i].hi = boundaries[j].lo;
          break;
        }
      }
    }
  }
  log.debug("computeWriteSeqBoundaries", {
    stepCount: steps.length,
    boundaries: boundaries.map((b) => ({ lo: b.lo, hi: b.hi === Infinity ? "∞" : b.hi })),
    agentMessageWriteSeqs: steps.map((s) => s.agentMessage?.writeSeq ?? null),
  });
  return boundaries;
}

/**
 * Attach per-step file edit summaries to an array of IntermediateSteps.
 * Uses O(W log W + S) algorithm: single sort of writes + linear scan
 * with lowerBound for partitioning.
 *
 * This is the v2 implementation replacing the O(S×W) filter approach.
 */
export function attachStepFileEditSummariesV2(
  steps: IntermediateStep[],
  agentId: string,
  sessionId: string
): void {
  if (steps.length === 0) return;
  const store = useFileWriteStore.getState();
  const allWrites = store.getWritesForSession(agentId, sessionId);
  if (allWrites.length === 0) {
    log.debug("attachStepFileEditSummariesV2: no writes for session", { agentId, sessionId });
    return;
  }

  const boundaries = computeWriteSeqBoundaries(steps);
  log.info("attachStepFileEditSummariesV2", {
    agentId,
    sessionId,
    stepCount: steps.length,
    writeCount: allWrites.length,
    boundaries: boundaries.map((b) => ({ lo: b.lo, hi: b.hi === Infinity ? "∞" : b.hi })),
    writeSeqs: allWrites.map((w) => w.seq),
    stepWriteSeqs: steps.map((s) => s.agentMessage?.writeSeq ?? null),
  });

  // O(W log W): single sort
  const sortedWrites = [...allWrites].sort((a, b) => a.seq - b.seq);

  // O(W + S): linear scan
  let writeIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    const { lo, hi } = boundaries[i];
    writeIdx = lowerBound(sortedWrites, lo, writeIdx);

    const stepWrites: FileWriteRecord[] = [];
    while (writeIdx < sortedWrites.length && sortedWrites[writeIdx].seq < hi) {
      stepWrites.push(sortedWrites[writeIdx]);
      writeIdx++;
    }

    if (stepWrites.length > 0) {
      const summary = buildSummaryFromWrites(stepWrites);
      if (summary) {
        log.debug("attachStepFileEditSummariesV2: summary attached to step", {
          stepIndex: i,
          isPreAgent: steps[i].isPreAgent,
          files: summary.map((s) => `${s.path} (+${s.lineCount})`),
        });
        steps[i] = { ...steps[i], fileEditSummary: summary };
      }
    }
  }
}

/**
 * Attach per-step file edit summaries to an array of IntermediateSteps.
 * Legacy O(S×W) implementation — kept for backward compatibility in tests.
 * New code should use attachStepFileEditSummariesV2.
 */
function attachStepFileEditSummaries(
  steps: IntermediateStep[],
  agentId: string,
  sessionId: string
): void {
  if (steps.length === 0) return;
  const store = useFileWriteStore.getState();
  const allWrites = store.getWritesForSession(agentId, sessionId);
  if (allWrites.length === 0) {
    log.debug("attachStepFileEditSummaries: no writes for session", { agentId, sessionId });
    return;
  }

  const boundaries = computeWriteSeqBoundaries(steps);
  log.info("attachStepFileEditSummaries", {
    agentId,
    sessionId,
    stepCount: steps.length,
    writeCount: allWrites.length,
    boundaries: boundaries.map((b) => ({ lo: b.lo, hi: b.hi === Infinity ? "∞" : b.hi })),
    writeSeqs: allWrites.map((w) => w.seq),
    stepWriteSeqs: steps.map((s) => s.agentMessage?.writeSeq ?? null),
  });

  for (let i = 0; i < steps.length; i++) {
    const { lo, hi } = boundaries[i];
    const stepWrites = allWrites.filter((w) => w.seq >= lo && w.seq < hi);
    const summary = buildSummaryFromWrites(stepWrites);
    if (summary) {
      log.debug("attachStepFileEditSummaries: summary attached to step", {
        stepIndex: i,
        isPreAgent: steps[i].isPreAgent,
        files: summary.map((s) => `${s.path} (+${s.lineCount})`),
      });
      steps[i] = { ...steps[i], fileEditSummary: summary };
    }
  }
}

function isToolItem(item: PipelineItem): boolean {
  return item.type === "chat" && item.role === "tool";
}

function isRealAgentChat(item: PipelineItem): boolean {
  return item.type === "chat" && item.role === "agent";
}

function isAgentOrTool(item: PipelineItem): boolean {
  return item.type === "chat" && (item.role === "agent" || item.role === "tool");
}

function isThinking(item: PipelineItem): boolean {
  return (
    item.type === "chat" &&
    item.role === "agent" &&
    (item as ChatDisplayItem).thinking != null
  );
}

/**
 * Extract the writeSeq from the first agent message in a list of items.
 * Returns 0 if no agent message with writeSeq is found (pre-agent steps).
 */
function firstWriteSeqOfItems(items: PipelineItem[]): number {
  for (const item of items) {
    if (item.type === "chat" && item.role === "agent" && item.writeSeq != null) {
      return item.writeSeq;
    }
  }
  return 0;
}

/**
 * Extract agentId and sessionId from the first chat item that carries them.
 */
function sessionOfItems(items: PipelineItem[]): { agentId: string; sessionId: string } {
  for (const item of items) {
    if (item.type === "chat") {
      const chat = item as ChatDisplayItem;
      if (chat.agentId && chat.sessionId) {
        return { agentId: chat.agentId, sessionId: chat.sessionId };
      }
    }
  }
  return { agentId: "", sessionId: "" };
}

/**
 * IntermediateStepGrouper groups PipelineItems by user-message boundaries
 * and organizes each group into steps.
 *
 * A "step" = agent message + subsequent tool calls.
 * Tool calls before any agent message are "pre-agent" steps.
 *
 * Core rules:
 * - A "group" starts after each user message and ends at the next user message.
 * - Within a group, items are split into steps at each real-agent-chat boundary.
 * - The last real agent chat (non-consecutive or stopReason) is the "final response".
 * - All other steps are intermediate (folded or shown).
 */
export class IntermediateStepGrouper {
  constructor(private items: PipelineItem[]) {}

  compute(): GroupedItems {
    return groupByUserBoundary(this.items);
  }
}

/**
 * Selects the final response from a flat list of agent/tool items.
 * The final response is the agent message the user sees outside the banner.
 *
 * Priority:
 * 1. stopReason — message carrying stopReason is the definitive final response.
 * 2. Last agent chat that is first-of-turn (i.e., starts a new step).
 * 3. Fallback — last non-promoted agent chat.
 */
export function selectFinalResponse(
  agentChats: PipelineItem[]
): FinalResponse | null {
  if (agentChats.length === 0) return null;

  // 1. stopReason-based
  const stopReasonIdx = agentChats.findIndex(
    (item) => item.type === "chat" && item.stopReason != null
  );
  if (stopReasonIdx !== -1) {
    return { item: agentChats[stopReasonIdx], index: stopReasonIdx };
  }

  // 2. Last agent chat that is first-of-turn (starts a new step)
  for (let i = agentChats.length - 1; i >= 0; i--) {
    const item = agentChats[i];
    if (item.type === "chat" && (item as ChatDisplayItem).isFirstOfTurn) {
      return { item, index: i };
    }
  }

  // 3. Fallback: last non-promoted agent chat
  for (let i = agentChats.length - 1; i >= 0; i--) {
    if (isRealAgentChat(agentChats[i])) {
      return { item: agentChats[i], index: i };
    }
  }

  return null;
}

/**
 * Split a flat list of agent/tool items into IntermediateStep[].
 *
 * Rules:
 * - A new step starts at each real-agent-chat (non-promoted) boundary.
 * - Tool calls before any real agent chat → pre-agent step(s).
 * - Each real-agent-chat + subsequent tool calls → one step.
 * - Thinking items are attached to the following agent message's step
 *   (they are part of the same agent turn).
 * - The finalResponse is included as a step (not excluded) so that
 *   tool calls following it are correctly attributed to the final step.
 *
 * messageId boundary:
 * - If the current agent message has a messageId and the most recent step's
 *   agentMessage has the same messageId, the content is appended to that
 *   step instead of starting a new one.  This handles the streaming case
 *   where a tool_call interrupts the stream and subsequent chunks of the
 *   same logical message arrive later.
 * - If the messageId differs (or either is missing), a new step is created
 *   as before.
 */
export function splitIntoSteps(
  items: PipelineItem[],
  _finalResponse: FinalResponse | null
): IntermediateStep[] {
  const steps: IntermediateStep[] = [];
  let pendingItems: ChatDisplayItem[] = [];
  let currentAgent: ChatDisplayItem | null = null;
  let currentTools: ChatDisplayItem[] = [];

  const flushAgentStep = () => {
    if (currentAgent != null) {
      steps.push({
        agentMessage: currentAgent,
        toolCalls: [...currentTools],
        isPreAgent: false,
      });
    }
    currentAgent = null;
    currentTools = [];
  };

  const flushPendingAsPreAgent = () => {
    if (pendingItems.length > 0) {
      steps.push({
        agentMessage: null,
        toolCalls: [...pendingItems],
        isPreAgent: true,
      });
    }
    pendingItems = [];
  };

  for (const item of items) {
    if (isThinking(item)) {
      if (currentAgent == null) {
        pendingItems.push(item as ChatDisplayItem);
      } else {
        flushAgentStep();
        pendingItems = [item as ChatDisplayItem];
      }
    } else if (isRealAgentChat(item)) {
      const agentItem = item as ChatDisplayItem;
      // Check if this agent message has the same messageId as the most
      // recently flushed step's agentMessage.  If so, append content
      // instead of starting a new step.
      const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
      const sameAsLastStep =
        lastStep != null &&
        !lastStep.isPreAgent &&
        lastStep.agentMessage != null &&
        agentItem.messageId != null &&
        agentItem.messageId === lastStep.agentMessage.messageId;

      if (
        currentAgent != null &&
        agentItem.messageId != null &&
        agentItem.messageId === currentAgent.messageId
      ) {
        // Same messageId as in-progress agent → merge into current step
        const merged: ChatDisplayItem = {
          ...currentAgent,
          content: currentAgent.content + agentItem.content,
        };
        currentAgent = merged;
        flushPendingAsPreAgent();
        continue;
      }

      if (sameAsLastStep && currentAgent == null) {
        // Same messageId as the most recent step → merge content into
        // that step and discard pending tools (they were already
        // absorbed into the step previously).
        const targetStep = lastStep!;
        const mergedAgent: ChatDisplayItem = {
          ...targetStep.agentMessage!,
          content: targetStep.agentMessage!.content + agentItem.content,
        };
        steps[steps.length - 1] = {
          ...targetStep,
          agentMessage: mergedAgent,
        };
        flushPendingAsPreAgent();
        continue;
      }

      flushAgentStep();
      flushPendingAsPreAgent();
      currentAgent = agentItem;
    } else if (isToolItem(item)) {
      if (currentAgent != null) {
        currentTools.push(item as ChatDisplayItem);
      } else {
        pendingItems.push(item as ChatDisplayItem);
      }
    } else {
      flushAgentStep();
      flushPendingAsPreAgent();
    }
  }

  flushAgentStep();
  flushPendingAsPreAgent();
  return steps;
}

export function groupByUserBoundary(items: PipelineItem[]): GroupedItems {
  const userIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "chat" && item.role === "user") {
      userIndices.push(i);
    }
  }

  if (userIndices.length === 0) {
    return { leading: items, groups: [], latestGroup: null, trailing: [] };
  }

  // Items before the first user message (system notices, compression, etc.)
  const firstUserIdx = userIndices[0];
  const leading = items.slice(0, firstUserIdx);

  const lastUserIdx = userIndices[userIndices.length - 1];
  const afterLastUser = items.slice(lastUserIdx + 1);

  const latestAgentChats = afterLastUser.filter(isAgentOrTool);
  const trailing = afterLastUser.filter((item) => !isAgentOrTool(item));

  const latestFinal = selectFinalResponse(latestAgentChats);

  // Only items BEFORE the final response are intermediate.  Items after the
  // final response (e.g., tool calls that logically belong to the final
  // step) must NOT be mixed into preceding intermediate steps — they form
  // the currentStep shown outside the banner.
  const latestFinalIdx = latestFinal
    ? latestAgentChats.findIndex((item) => item.key === latestFinal.item.key)
    : -1;
  const latestIntermediateItems =
    latestFinalIdx >= 0
      ? latestAgentChats.slice(0, latestFinalIdx)
      : latestAgentChats;
  const latestSteps = splitIntoSteps(latestIntermediateItems, null);

  // Per-step file edit summaries are now computed externally via
  // useFileEditSummaryMap hook in SessionChatContainer, keeping step
  // objects immutable for React.memo optimization.
  // Here we only need to strip any fileEditSummary from steps.
  const stripFES = (s: IntermediateStep) => {
    if (!s.fileEditSummary) return s;
    const { fileEditSummary: _, ...rest } = s;
    return rest;
  };
  const partitionedLatestSteps = latestSteps.map(stripFES);
  const latestSession = sessionOfItems(afterLastUser);
  const allLatestWrites = [...useFileWriteStore.getState().getWritesForSession(latestSession.agentId, latestSession.sessionId)].sort((a, b) => a.seq - b.seq);
  const latestFirstWriteSeq = firstWriteSeqOfItems(afterLastUser);
  const scopedLatestWrites = getWritesForTurn(allLatestWrites, latestFirstWriteSeq, null);

  const finalStepSummary = buildSummaryFromWrites(scopedLatestWrites) ?? undefined;

  let latestCurrentStep: IntermediateStep | null = null;
  if (latestFinal && latestFinalIdx >= 0) {
    const postFinalItems = latestAgentChats.slice(latestFinalIdx + 1);
    if (postFinalItems.length > 0) {
      latestCurrentStep = {
        agentMessage: latestFinal.item as ChatDisplayItem,
        toolCalls: postFinalItems as ChatDisplayItem[],
        isPreAgent: false,
        fileEditSummary: finalStepSummary,
      };
    }
  }

  const latestTurnSummary = buildSummaryFromWrites(scopedLatestWrites) ?? undefined;

  log.info("groupByUserBoundary: latestGroup", {
    userItemKey: items[lastUserIdx].key,
    stepCount: partitionedLatestSteps.length,
    finalResponseKey: latestFinal?.item.key ?? null,
    finalResponseStopReason: (latestFinal?.item as ChatDisplayItem)?.stopReason ?? null,
    currentStepAgentKey: latestCurrentStep?.agentMessage?.key ?? null,
    currentStepFES: latestCurrentStep?.fileEditSummary?.length ?? 0,
    turnFESLength: latestTurnSummary?.length ?? 0,
    turnFESEntries: latestTurnSummary?.map(e => `${e.path} (+${e.lineCount})`) ?? [],
    agentMessageWriteSeqs: partitionedLatestSteps.map(s => s.agentMessage?.writeSeq ?? null),
    sessionKey: `${latestSession.agentId}:${latestSession.sessionId}`,
    writeCount: scopedLatestWrites.length,
  });

  // When finalResponse exists with writes but NO post-final items, create a
  // synthetic currentStep that carries the fileEditSummary — this ensures
  // the final step's file edits are shown both per-step AND as part of the
  // turn-level summary without duplication (the SessionChatContainer hides
  // turnFileEditSummary when currentStep is present).
  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    steps: partitionedLatestSteps,
    finalResponse: latestFinal,
    currentStep: latestCurrentStep ?? (finalStepSummary
      ? {
          agentMessage: latestFinal!.item as ChatDisplayItem,
          toolCalls: [],
          isPreAgent: false,
          fileEditSummary: finalStepSummary,
        }
      : null),
    turnFileEditSummary: latestTurnSummary,
    passthrough: [],
  };

  const groups: AgentResponseGroup[] = [];
  for (let g = 0; g < userIndices.length - 1; g++) {
    const startIdx = userIndices[g];
    const endIdx = userIndices[g + 1];
    const groupItems = items.slice(startIdx + 1, endIdx);

    const turnAgentChats = groupItems.filter(isAgentOrTool);
    const final = selectFinalResponse(turnAgentChats);

    // Same logic: only pre-final items are intermediate.
    const finalIdx = final
      ? turnAgentChats.findIndex((item) => item.key === final.item.key)
      : -1;
    const intermediateItems =
      finalIdx >= 0
        ? groupItems.filter(
            (item) =>
              item.key !== final!.item.key &&
              turnAgentChats.findIndex((ac) => ac.key === item.key) < finalIdx
          )
        : groupItems;
    const steps = splitIntoSteps(intermediateItems, null);

    // Attach per-step file edit summaries
    const turnSession = sessionOfItems(groupItems);
    // Per-step file edit summaries moved to useFileEditSummaryMap hook.
    // Skipped here to keep step objects immutable for React.memo.

    // Turn-level file edit summary: scoped to THIS turn's writes only
    const allTurnWrites = [...useFileWriteStore.getState().getWritesForSession(turnSession.agentId, turnSession.sessionId)].sort((a, b) => a.seq - b.seq);
    const turnFirstWriteSeq = firstWriteSeqOfItems(groupItems);
    const nextGroupItems = g + 1 < userIndices.length - 1
      ? items.slice(userIndices[g + 1] + 1, userIndices[g + 2])
      : afterLastUser;
    const nextTurnFirstWriteSeq = firstWriteSeqOfItems(nextGroupItems);
    const scopedTurnWrites = getWritesForTurn(allTurnWrites, turnFirstWriteSeq, nextTurnFirstWriteSeq);
    const turnSummary = buildSummaryFromWrites(scopedTurnWrites) ?? undefined;

    // Non-agent/tool items between two user messages: compression, mode_change,
    // error_notice, custom. These were splitIntoSteps input but silently dropped
    // because splitIntoSteps only emits IntermediateStep for chat-agent/tool items.
    // Collect them as passthrough so they render between groups.
    const passthrough = finalIdx >= 0
      ? groupItems.filter(
          (item) =>
            item.key !== final!.item.key &&
            !turnAgentChats.find((ac) => ac.key === item.key)
        )
      : groupItems.filter((item) => !isAgentOrTool(item));

    groups.push({
      userItem: items[startIdx],
      steps,
      finalResponse: final,
      currentStep: null,
      turnFileEditSummary: turnSummary,
      passthrough,
    });
  }

  return { leading, groups, latestGroup, trailing };
}

/**
 * Split the latest group's steps for rendering.
 * Returns olderSteps (folded in banner) and the currentStep (shown outside).
 *
 * The currentStep is always the last step (which may contain the finalResponse
 * agent message + subsequent tool calls).  This ensures that tool calls following
 * the final response are rendered under the latest step, not folded into a
 * preceding step.
 *
 * When `currentStep` is provided (set by groupByUserBoundary when tool calls
 * follow the final response), it takes precedence — it is rendered outside
 * the banner regardless of `hasFinal`, so that post-final tool calls are
 * correctly attributed to the final step.
 */
export function splitLatestSteps(
  steps: IntermediateStep[],
  hasFinal: boolean,
  currentStep: IntermediateStep | null = null
): {
  olderSteps: IntermediateStep[];
  currentStep: IntermediateStep | null;
} {
  if (currentStep != null) {
    // Post-final tool calls exist → render them as the current step outside
    // the banner.  All intermediate steps are folded.
    return { olderSteps: steps, currentStep };
  }
  if (steps.length === 0) {
    return { olderSteps: [], currentStep: null };
  }
  if (hasFinal) {
    // Final response is rendered separately via DisplayItemView;
    // all steps go into the banner (folded).
    return { olderSteps: steps, currentStep: null };
  }
  // No final response yet: peel the last step as current (shown outside banner)
  return {
    olderSteps: steps.slice(0, -1),
    currentStep: steps[steps.length - 1],
  };
}
