import type { ChatDisplayItem, FileEditEntry, IntermediateStep, PipelineItem } from "../types";
import { sessionKeyOf } from "../../store/sessionStore";
import { useFileWriteStore } from "../../store/fileWriteStore";
import type { FileWriteRecord } from "../../store/fileWriteStore";
import { getLogger } from "../../lib/logger";

const log = getLogger("pipeline.grouping");

// ── Types ───────────────────────────────────────────────────────────────────

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
}

export interface GroupedItems {
  groups: AgentResponseGroup[];
  latestGroup: AgentResponseGroup | null;
  trailing: PipelineItem[];
}

// ── File edit summary extraction ────────────────────────────────────────────

/**
 * Count lines written by an ACP fs/write_text_file call.
 * The content is the full file content; count newlines + 1 for the
 * last line if it doesn't end with \n.
 */
export function countWrittenLines(content: string): number {
  if (!content) return 0;
  const newlines = (content.match(/\n/g) ?? []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * Build a FileEditEntry[] from a slice of FileWriteRecords.
 * Multiple writes to the same path are merged (line counts summed).
 * Original content is taken from the first write to each path.
 */
function buildSummaryFromWrites(writes: FileWriteRecord[]): FileEditEntry[] | undefined {
  if (writes.length === 0) return undefined;

  const seen = new Map<string, FileEditEntry>();
  for (const w of writes) {
    const lineCount = countWrittenLines(w.content);
    const existing = seen.get(w.path);
    if (existing) {
      existing.lineCount += lineCount;
      // Later writes override earlier written content
      existing.writtenContent = w.content;
    } else {
      seen.set(w.path, {
        path: w.path,
        lineCount,
        kind: "fs/write_text_file",
        originalContent: w.originalContent,
        writtenContent: w.content,
      });
    }
  }
  return Array.from(seen.values());
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

// ── Per-step file edit partitioning ─────────────────────────────────────────

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
  log.debug("computeWriteSeqBoundaries", {
    stepCount: steps.length,
    boundaries: boundaries.map((b) => ({ lo: b.lo, hi: b.hi === Infinity ? "∞" : b.hi })),
    agentMessageWriteSeqs: steps.map((s) => s.agentMessage?.writeSeq ?? null),
  });
  return boundaries;
}

/**
 * Attach per-step file edit summaries to an array of IntermediateSteps.
 * Partitions the session's writes by writeSeq boundaries derived from
 * each step's agent message.
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function isPromotedTool(item: PipelineItem): boolean {
  return (
    item.type === "chat" &&
    item.role === "agent" &&
    (item as ChatDisplayItem).originalRole === "tool"
  );
}

function isRealAgentChat(item: PipelineItem): boolean {
  return (
    item.type === "chat" &&
    item.role === "agent" &&
    (item as ChatDisplayItem).originalRole !== "tool"
  );
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

// ── IntermediateStepGrouper ─────────────────────────────────────────────────

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

// ── selectFinalResponse ─────────────────────────────────────────────────────

/**
 * Selects the final response from a flat list of agent/tool items.
 * The final response is the agent message the user sees outside the banner.
 *
 * Priority:
 * 1. stopReason — message carrying stopReason is the definitive final response.
 * 2. Last non-consecutive agent chat (not a promoted tool).
 * 3. Fallback — last non-promoted agent chat (even if consecutive).
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

  // 2. Last non-consecutive agent chat (not a promoted tool)
  const isNonConsecutiveAgent = (item: PipelineItem) =>
    isRealAgentChat(item) && !(item as ChatDisplayItem).isConsecutive;
  for (let i = agentChats.length - 1; i >= 0; i--) {
    if (isNonConsecutiveAgent(agentChats[i])) {
      return { item: agentChats[i], index: i };
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

// ── splitIntoSteps ──────────────────────────────────────────────────────────

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
 */
export function splitIntoSteps(
  items: PipelineItem[],
  finalResponse: FinalResponse | null
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
      flushAgentStep();
      if (pendingItems.length > 0) {
        currentTools = [...pendingItems];
        pendingItems = [];
      }
      currentAgent = item as ChatDisplayItem;
    } else if (isPromotedTool(item)) {
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

// ── groupByUserBoundary ─────────────────────────────────────────────────────

function groupByUserBoundary(items: PipelineItem[]): GroupedItems {
  const userIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "chat" && item.role === "user") {
      userIndices.push(i);
    }
  }

  if (userIndices.length === 0) {
    return { groups: [], latestGroup: null, trailing: [] };
  }

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

  // Attach per-step file edit summaries.
  // The finalResponse acts as a virtual step for partitioning: its writeSeq
  // defines the boundary between intermediate steps and the final step.
  const latestSession = sessionOfItems(afterLastUser);
  const finalStepForPartition: IntermediateStep | null = latestFinal
    ? {
        agentMessage: latestFinal.item as ChatDisplayItem,
        toolCalls: [],
        isPreAgent: false,
      }
    : null;
  const allStepsForPartition = finalStepForPartition
    ? [...latestSteps, finalStepForPartition]
    : latestSteps;
  attachStepFileEditSummaries(allStepsForPartition, latestSession.agentId, latestSession.sessionId);

  const finalStepSummary = finalStepForPartition
    ? allStepsForPartition[allStepsForPartition.length - 1].fileEditSummary
    : undefined;
  const partitionedLatestSteps = finalStepForPartition
    ? allStepsForPartition.slice(0, -1)
    : allStepsForPartition;

  // currentStep with file edits for the final step
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

  // Turn-level file edit summary: ALL writes for this session merged
  const latestTurnSummary = buildSummaryFromWrites(
    useFileWriteStore.getState().getWritesForSession(latestSession.agentId, latestSession.sessionId)
  ) ?? undefined;

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
    writeCount: useFileWriteStore.getState().getWritesForSession(latestSession.agentId, latestSession.sessionId).length,
  });

  // When finalResponse exists, don't set fileEditSummary on currentStep —
  // turnFileEditSummary (shown below the final response) handles aggregate display.
  // During streaming (no finalResponse), currentStep is null and peeled from
  // steps in splitLatestSteps, which correctly sets per-step fileEditSummary.
  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    steps: partitionedLatestSteps,
    finalResponse: latestFinal,
    currentStep: latestCurrentStep ?? (finalStepSummary
      ? {
          agentMessage: latestFinal!.item as ChatDisplayItem,
          toolCalls: [],
          isPreAgent: false,
        }
      : null),
    turnFileEditSummary: latestTurnSummary,
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
    attachStepFileEditSummaries(steps, turnSession.agentId, turnSession.sessionId);

    // Turn-level file edit summary: ALL writes for this session merged
    const turnSummary = buildSummaryFromWrites(
      useFileWriteStore.getState().getWritesForSession(turnSession.agentId, turnSession.sessionId)
    ) ?? undefined;

    groups.push({
      userItem: items[startIdx],
      steps,
      finalResponse: final,
      currentStep: null,
      turnFileEditSummary: turnSummary,
    });
  }

  return { groups, latestGroup, trailing };
}

// ── Latest group rendering helpers ─────────────────────────────────────────

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
