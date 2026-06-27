import type { ChatDisplayItem, IntermediateStep, PipelineItem } from "../types";

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
}

export interface GroupedItems {
  groups: AgentResponseGroup[];
  latestGroup: AgentResponseGroup | null;
  trailing: PipelineItem[];
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

  // currentStep = final response + subsequent tool calls (if any).
  // When tool calls follow the final response, they are rendered as part of
  // the current step, not folded into the banner.
  let latestCurrentStep: IntermediateStep | null = null;
  if (latestFinal && latestFinalIdx >= 0) {
    const postFinalItems = latestAgentChats.slice(latestFinalIdx + 1);
    if (postFinalItems.length > 0) {
      latestCurrentStep = {
        agentMessage: latestFinal.item as ChatDisplayItem,
        toolCalls: postFinalItems as ChatDisplayItem[],
        isPreAgent: false,
      };
    }
  }

  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    steps: latestSteps,
    finalResponse: latestFinal,
    currentStep: latestCurrentStep,
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

    groups.push({
      userItem: items[startIdx],
      steps,
      finalResponse: final,
      currentStep: null,
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
