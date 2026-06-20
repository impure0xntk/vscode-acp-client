import React, {
  useRef,
  memo,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from "react";
import { DisplayItemView } from "../message/DisplayItemView";
import { IntermediateStepsBanner } from "../message/IntermediateStepsBanner";
import { useMessages } from "../../hooks/useMessages";
import { useMessagePipeline } from "../../hooks/useMessagePipeline";
import { useScrollController } from "../../hooks/useScrollController";
import { useSessionUnreadCount } from "../../hooks/useSessionUnreadCount";
import { useScrollStateStore } from "../../store/scrollStateStore";
import { useMessageStore } from "../../store/messageStore";
import {
  useIntermediateStepsCollapseMap,
  useToggleIntermediateSteps,
} from "../../hooks/useIntermediateStepsCollapse";
import type { PipelineItem } from "../../pipeline";
import type { ChatDisplayItem } from "../../pipeline/types";

// ── Constants ───────────────────────────────────────────────────────────────

const SCROLL_BOTTOM_THRESHOLD = 100;

// ── Types ───────────────────────────────────────────────────────────────────

/** Final response extracted from a turn (first non-consecutive agent chat) */
interface FinalResponse {
  /** The first agent chat message that starts the turn response (isConsecutive === false) */
  item: PipelineItem;
  /** Index within the turn's items array */
  index: number;
}

/** Response group corresponding to a single user message */
interface AgentResponseGroup {
  /** The user message that starts this group (boundary) */
  userItem: PipelineItem;
  /** Intermediate steps (thinking, tool calls, consecutive agent messages) — these get folded */
  items: PipelineItem[];
  /** The final response of this turn (first agent chat with isConsecutive === false), if any */
  finalResponse: FinalResponse | null;
}

interface GroupedItems {
  /** Groups before the last one (candidates for collapsing) */
  groups: AgentResponseGroup[];
  /** The latest group (after the last user message, not collapsed) */
  latestGroup: AgentResponseGroup | null;
  /** Non-agent items in the latest group (system notices, compression, etc.) */
  trailing: PipelineItem[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Groups items by user message boundaries.
 * Each user message starts a group; all items until the next user message belong to that group.
 * The last group is not collapsed (shown as the final response).
 * Earlier groups are each rendered as a collapsible IntermediateStepsBanner.
 *
 * Only agent-role messages qualify as final responses.
 * Tool-role messages are always treated as intermediate steps.
 * This ensures that when the first response is a tool call, subsequent agent messages display correctly.
 */
function groupByUserBoundary(items: PipelineItem[]): GroupedItems {
  // Collect user message indices
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

  // Index of the last user message
  const lastUserIdx = userIndices[userIndices.length - 1];

  // All items after the last user message
  const afterLastUser = items.slice(lastUserIdx + 1);

  // Agent/tool response items: chat with agent or tool role.
  // Promoted tool messages (role=agent, originalRole=tool) are included here
  // but filtered out when selecting the final response.
  const isAgentOrToolLatest = (item: PipelineItem) =>
    item.type === "chat" && (item.role === "agent" || item.role === "tool");

  const latestAgentChats = afterLastUser.filter(isAgentOrToolLatest);

  // Trailing: non-agent/tool chat items (system notices, compression, etc.)
  const trailing = afterLastUser.filter((item) => !isAgentOrToolLatest(item));

  // Final response of the latest group: first agent chat with isConsecutive === false.
  // Tool role is always treated as intermediate steps.
  // Promoted tool messages (role=agent, originalRole=tool) are also intermediate.
  // If all agent messages are consecutive (isConsecutive === true), fall back to
  // the last non-promoted agent message as the final response — otherwise the
  // turn would have no visible final response and only show intermediate steps.
  const isFinalCandidate = (item: PipelineItem) =>
    item.type === "chat" &&
    item.role === "agent" &&
    (item as ChatDisplayItem).originalRole !== "tool" &&
    !item.isConsecutive;
  let latestFinalIdx = latestAgentChats.findIndex(isFinalCandidate);
  if (latestFinalIdx === -1) {
    // All agent messages are consecutive — pick the last non-promoted one
    for (let i = latestAgentChats.length - 1; i >= 0; i--) {
      const item = latestAgentChats[i];
      if (item.type === "chat" && item.role === "agent" &&
          (item as ChatDisplayItem).originalRole !== "tool") {
        latestFinalIdx = i;
        break;
      }
    }
  }
  const latestFinal =
    latestFinalIdx === -1 ? null : latestAgentChats[latestFinalIdx];
  // Filter by key (not reference) because processIncremental creates new
  // PipelineItem objects each time, so reference equality would fail and
  // the final response would appear both inside the banner and as the
  // standalone final display.
  const latestIntermediate = latestFinal
    ? latestAgentChats.filter((item) => item.key !== latestFinal.key)
    : latestAgentChats;

  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    items: latestIntermediate,
    finalResponse: latestFinal
      ? { item: latestFinal, index: latestFinalIdx }
      : null,
  };

  // Groups before the last one
  const groups: AgentResponseGroup[] = [];
  for (let g = 0; g < userIndices.length - 1; g++) {
    const startIdx = userIndices[g];
    const endIdx = userIndices[g + 1];
    const groupItems = items.slice(startIdx + 1, endIdx);

    // Identify the final response of each group (agent role only, not promoted tools)
    const isAgentOrToolInGroup = (item: PipelineItem) =>
      item.type === "chat" && (item.role === "agent" || item.role === "tool");
    const turnAgentChats = groupItems.filter(isAgentOrToolInGroup);
    const isFinalCandidateGroup = (item: PipelineItem) =>
      item.type === "chat" &&
      item.role === "agent" &&
      (item as ChatDisplayItem).originalRole !== "tool" &&
      !item.isConsecutive;
    let finalIdxInTurn = turnAgentChats.findIndex(isFinalCandidateGroup);
    // Fallback: if all agent messages are consecutive, pick the last non-promoted one
    if (finalIdxInTurn === -1) {
      for (let i = turnAgentChats.length - 1; i >= 0; i--) {
        const item = turnAgentChats[i];
        if (item.type === "chat" && item.role === "agent" &&
            (item as ChatDisplayItem).originalRole !== "tool") {
          finalIdxInTurn = i;
          break;
        }
      }
    }
    // Final response is rendered outside the banner
    const finalItem =
      finalIdxInTurn === -1 ? null : turnAgentChats[finalIdxInTurn];
    // intermediate: all items except the final response
    // Filter by key (not reference) for the same reason as above.
    const intermediateItems = finalItem
      ? groupItems.filter((item) => item.key !== finalItem.key)
      : groupItems;

    groups.push({
      userItem: items[startIdx],
      items: intermediateItems,
      finalResponse: finalItem
        ? { item: finalItem, index: finalIdxInTurn }
        : null,
    });
  }

  return { groups, latestGroup, trailing };
}

// ── Props ───────────────────────────────────────────────────────────────────

export interface SessionChatContainerProps {
  sessionKey: string | null;
  sessionId?: string;
  agentId?: string;
  status?:
    | "idle"
    | "running"
    | "cancelling"
    | "completed"
    | "error"
    | "cancelled"
    | "warning";
  isActive?: boolean;
  color?: string;

  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<
    ((firstUnreadId: string) => void) | undefined
  >;
  /** Called on scroll events with raw DOM metrics. */
  onScroll?: (metrics: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    isAtBottom: boolean;
  }) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const SessionChatContainer = memo(function SessionChatContainer({
  sessionKey,
  sessionId,
  agentId,
  status,
  isActive,
  color,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  onScroll,
}: SessionChatContainerProps): React.ReactElement {
  const { messages: rawMessages, isStreaming } = useMessages(
    sessionKey ?? null
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  // Unread count for badge
  const unreadCount = useSessionUnreadCount(sessionKey);

  // Local isAtBottom state for scroll button visibility
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  // Process raw messages through the pipeline
  const items = useMessagePipeline(rawMessages, sessionId ?? "", agentId ?? "");

  // ── Group items by user boundary ─────────────────────────────────
  const { groups, latestGroup, trailing } = useMemo(
    () => groupByUserBoundary(items),
    [items]
  );

  // ── Per-group collapse state ─────────────────────────────────────────
  // Read via dedicated hooks that use useSyncExternalStore with cached
  // getSnapshot — the same pattern as useSessionUnreadCount.  This keeps
  // the returned object referentially stable and prevents the
  // store-update → new ref → effect re-fire loop.
  const collapsedMap = useIntermediateStepsCollapseMap(sessionKey ?? null);
  const toggleIntermediateSteps = useToggleIntermediateSteps();

  const prevStreamingRef = useRef(isStreaming);
  const prevRawLenRef = useRef(rawMessages.length);

  // Keep refs to the latest collapsedMap and toggle so the effect below
  // does NOT list them in its dependency array — preventing the
  // store-update → new ref → effect re-fire → store-update loop.
  const collapsedMapRef = useRef(collapsedMap);
  collapsedMapRef.current = collapsedMap;
  const toggleRef = useRef(toggleIntermediateSteps);
  toggleRef.current = toggleIntermediateSteps;

  // auto-collapse: when the latest group gains a final response (streaming just
  // completed), render intermediate steps expanded for one frame then collapse.
  const [latestAutoCollapse, setLatestAutoCollapse] = useState(false);
  const prevHasFinalRef = useRef(false);
  // Keep a ref to the latest group so the streaming→completed effect can
  // read it without being in the dependency array (prevents spurious re-runs
  // from useMemo producing new object references).
  const latestGroupRef = useRef(latestGroup);
  latestGroupRef.current = latestGroup;

  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    const group = latestGroupRef.current;
    const hasFinal = group?.finalResponse != null;

    // Streaming → completed transition: reset store collapse state to collapsed
    // Read from refs — NOT from the store selector — to avoid re-fire.
    if (prev && !isStreaming && group && sessionKey) {
      const gid = group.userItem.key;
      if (!collapsedMapRef.current[gid]) {
        toggleRef.current(sessionKey, gid); // ensure collapsed
      }
    }

    // Detect the exact moment a final response appears for the first time.
    if (hasFinal && !prevHasFinalRef.current && !isStreaming) {
      setLatestAutoCollapse(true);
    }
    prevHasFinalRef.current = hasFinal;
  }, [isStreaming, sessionKey]);

  // Reset auto-collapse when a new message is posted
  useEffect(() => {
    const currentLen = rawMessages.length;
    const prevLen = prevRawLenRef.current;
    prevRawLenRef.current = currentLen;
    if (currentLen > prevLen) {
      setLatestAutoCollapse(false);
    }
  }, [rawMessages.length]);

  // Helper: is a group manually expanded?
  const isGroupExpanded = useCallback(
    (group: AgentResponseGroup): boolean => {
      const gid = group.userItem.key;
      // If the user has toggled it expanded (store says false = not collapsed = expanded)
      return collapsedMap[gid] === false;
    },
    [collapsedMap]
  );

  const { scrollToMessage, scrollToUnread, forceScrollToBottom } =
    useScrollController(
      sessionKey ?? null,
      containerRef,
      bottomRef,
      isAtBottom,
      items.length
    );

  // ── Expose imperative refs ─────────────────────────────────────────
  useEffect(() => {
    if (scrollToMessageRef) scrollToMessageRef.current = scrollToMessage;
  }, [scrollToMessageRef, scrollToMessage]);

  useEffect(() => {
    if (forceScrollToBottomRef)
      forceScrollToBottomRef.current = forceScrollToBottom;
  }, [forceScrollToBottomRef, forceScrollToBottom]);

  useEffect(() => {
    if (scrollToUnreadRef) scrollToUnreadRef.current = scrollToUnread;
  }, [scrollToUnreadRef, scrollToUnread]);

  // ── Save scroll position on unmount (session switch / close) ───────
  useEffect(() => {
    const el = containerRef.current;
    return () => {
      const key = sessionKeyRef.current;
      if (key && el) {
        const { scrollTop, scrollHeight, clientHeight } = el;
        const distance = scrollHeight - scrollTop - clientHeight;
        useScrollStateStore.getState().setScrollTop(key, scrollTop);
        useScrollStateStore
          .getState()
          .setIsAtBottom(key, distance < SCROLL_BOTTOM_THRESHOLD);
      }
    };
  }, []);

  // ── Scroll handler with read-up-to tracking ────────────────────────
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distance = scrollHeight - scrollTop - clientHeight;
    const atBottom = distance < SCROLL_BOTTOM_THRESHOLD;

    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }

    const key = sessionKeyRef.current;
    if (key) {
      const store = useScrollStateStore.getState();
      store.setScrollTop(key, scrollTop);
      store.setIsAtBottom(key, atBottom);
      if (atBottom) {
        const ids = useMessageStore.getState().perSession[key];
        const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
        store.setReadUpTo(key, newestId);
      }
    }

    onScrollRef.current?.({
      scrollTop,
      scrollHeight,
      clientHeight,
      isAtBottom: atBottom,
    });
  }, []);

  // ── Auto-advance readUpTo when at bottom and new messages arrive ───
  const msgCountRef = useRef(0);
  useEffect(() => {
    if (!sessionKey || !isAtBottom) return;
    const ids = useMessageStore.getState().perSession[sessionKey];
    const len = ids?.length ?? 0;
    if (len <= msgCountRef.current) return;
    msgCountRef.current = len;
    const store = useScrollStateStore.getState();
    const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
    store.setReadUpTo(sessionKey, newestId);
  }, [sessionKey, isAtBottom, unreadCount]);

  // ── Scroll to bottom handler (for button click) ────────────────────
  const handleScrollToBottom = useCallback(() => {
    const wrapper = wrapperRef.current?.querySelector(
      ".chat-container"
    ) as HTMLDivElement | null;
    if (wrapper) {
      wrapper.scrollTop = wrapper.scrollHeight;
    } else {
      forceScrollToBottomRef?.current?.();
    }
  }, [forceScrollToBottomRef]);

  // ── Render ──────────────────────────────────────────────────────────
  const isEmpty = items.length === 0;
  const showScrollButton = !isAtBottom;

  return (
    <div className="section-chat-container-wrapper" ref={wrapperRef}>
      <div
        className="chat-container"
        ref={containerRef}
        onScroll={handleScroll}
        data-messages-scroll-container="true"
      >
        {isEmpty ? (
          <div className="empty-state">
            <p className="empty-title">ACP Chat</p>
            <p className="empty-hint">
              {sessionId
                ? "Send a message to start the conversation."
                : "Connect to an agent and create a session to start."}
            </p>
          </div>
        ) : (
          <div className={`message-list${isStreaming ? " message-list--streaming" : ""}`}>
            {/* Past groups */}
            {groups.map((group, groupIdx) => {
              const expanded = isGroupExpanded(group);
              return (
                <React.Fragment key={group.userItem.key}>
                  <DisplayItemView
                    item={group.userItem}
                    idx={0}
                    items={[group.userItem]}
                    sessionId={sessionId}
                    agentId={agentId}
                    appearDelay={groupIdx * 30}
                  />
                  <IntermediateStepsBanner
                    items={group.items}
                    defaultCollapsed={true}
                    forceExpanded={expanded}
                    sessionId={sessionId}
                    agentId={agentId}
                    onToggle={() =>
                      toggleIntermediateSteps(sessionKey!, group.userItem.key)
                    }
                  />
                  {expanded && group.items.length > 0 && (
                    <div className="intermediate-steps-expanded-body">
                      {group.items.map((item, idx) => (
                        <DisplayItemView
                          key={item.key}
                          item={item}
                          idx={idx}
                          items={group.items}
                          sessionId={sessionId}
                          agentId={agentId}
                          appearDelay={(groupIdx * 30) + (idx + 1) * 30}
                        />
                      ))}
                    </div>
                  )}
                  {group.finalResponse && (
                    <DisplayItemView
                      item={group.finalResponse.item}
                      idx={0}
                      items={[group.finalResponse.item]}
                      sessionId={sessionId}
                      agentId={agentId}
                      appearDelay={(groupIdx * 30) + (group.items.length + 1) * 30}
                    />
                  )}
                </React.Fragment>
              );
            })}

            {/* Latest group */}
            {latestGroup &&
              (() => {
                const expanded = isStreaming || isGroupExpanded(latestGroup);
                const baseDelay = groups.length * 30;
                return (
                  <React.Fragment key="latest-group">
                    <DisplayItemView
                      item={latestGroup.userItem}
                      idx={0}
                      items={[latestGroup.userItem]}
                      sessionId={sessionId}
                      agentId={agentId}
                      appearDelay={baseDelay}
                    />
                    {latestGroup.items.length > 0 && (
                      <IntermediateStepsBanner
                        items={latestGroup.items}
                        defaultCollapsed={true}
                        forceExpanded={expanded}
                        sessionId={sessionId}
                        agentId={agentId}
                        autoCollapse={latestAutoCollapse}
                        onToggle={() =>
                          toggleIntermediateSteps(
                            sessionKey!,
                            latestGroup.userItem.key
                          )
                        }
                      />
                    )}
                    {expanded && latestGroup.items.length > 0 && (
                      <div className="intermediate-steps-expanded-body">
                        {latestGroup.items.map((item, idx) => (
                          <DisplayItemView
                            key={item.key}
                            item={item}
                            idx={idx}
                            items={latestGroup.items}
                            sessionId={sessionId}
                            agentId={agentId}
                            appearDelay={baseDelay + (idx + 1) * 30}
                          />
                        ))}
                      </div>
                    )}
                    {latestGroup.finalResponse && (
                      <DisplayItemView
                        item={latestGroup.finalResponse.item}
                        idx={0}
                        items={[latestGroup.finalResponse.item]}
                        sessionId={sessionId}
                        agentId={agentId}
                        appearDelay={baseDelay + (latestGroup.items.length + 1) * 30}
                      />
                    )}
                  </React.Fragment>
                );
              })()}

            {/* Trailing items */}
            {trailing.map((item, idx) => (
              <DisplayItemView
                key={item.key}
                item={item}
                idx={idx}
                items={trailing}
                sessionId={sessionId}
                agentId={agentId}
                appearDelay={(groups.length + (latestGroup ? 1 : 0)) * 30 + idx * 30}
              />
            ))}

            {isStreaming && (
              <div className="streaming-cursor">
                <span className="cursor-blink">▋</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} data-bottom-anchor="true" />
      </div>
      {showScrollButton && (
        <button
          className="scroll-to-bottom-button"
          onClick={handleScrollToBottom}
          type="button"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <span className="scroll-to-bottom-icon">↓</span>
          {unreadCount > 0 && (
            <span className="scroll-to-bottom-badge">{unreadCount}</span>
          )}
        </button>
      )}
    </div>
  );
});
