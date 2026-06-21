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

// ── Sticky User Message Types ──────────────────────────────────────────────

interface StickyUserMessage {
  key: string;
  content: string;
  timestamp: number | undefined;
  attachments: ChatDisplayItem["attachments"];
}

// ── Sticky User Message Helpers ─────────────────────────────────────────────

function findStickyUserMessage(
  containerEl: HTMLDivElement,
  userMessageEls: { key: string; el: HTMLElement }[]
): StickyUserMessage | null {
  const containerRect = containerEl.getBoundingClientRect();
  const containerTop = containerRect.top;

  const aboveViewport: { key: string; el: HTMLElement; bottom: number }[] = [];
  for (const { key, el } of userMessageEls) {
    const rect = el.getBoundingClientRect();
    const bottom = rect.bottom;
    if (bottom < containerTop - 4) {
      aboveViewport.push({ key, el, bottom });
    }
  }

  if (aboveViewport.length === 0) return null;

  const lastAbove = aboveViewport[aboveViewport.length - 1];

  const contentEl = lastAbove.el.querySelector(".message-text");
  const content = contentEl?.textContent ?? "";

  const timeEl = lastAbove.el.querySelector(".message-time");
  const timeStr = timeEl?.textContent ?? "";
  const timestamp = timeStr ? Date.parse(timeStr) : undefined;

  const attachmentEls = lastAbove.el.querySelectorAll(".file-chip-inline");
  const attachments: ChatDisplayItem["attachments"] = [];
  attachmentEls.forEach((chip) => {
    const label = chip.querySelector(".file-chip-label")?.textContent ?? "";
    const path = chip.getAttribute("title") ?? label;
    const tokens = chip.querySelector(".file-chip-tokens")?.textContent ?? "0t";
    attachments.push({
      id: `sticky-${lastAbove.key}-${attachments.length}`,
      type: "file",
      path,
      label,
      lineRange: undefined,
      tokenCount: parseInt(tokens, 10) || 0,
      isNavigable: true,
      extension: path.split(".").pop() ?? "",
      detail: "",
    });
  });

  return {
    key: lastAbove.key,
    content,
    timestamp,
    attachments,
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

interface FinalResponse {
  item: PipelineItem;
  index: number;
}

interface AgentResponseGroup {
  userItem: PipelineItem;
  items: PipelineItem[];
  finalResponse: FinalResponse | null;
}

interface GroupedItems {
  groups: AgentResponseGroup[];
  latestGroup: AgentResponseGroup | null;
  trailing: PipelineItem[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function selectFinalResponse(
  agentChats: PipelineItem[]
): { item: PipelineItem; index: number } | null {
  if (agentChats.length === 0) return null;

  const stopReasonIdx = agentChats.findIndex(
    (item) => item.type === "chat" && item.stopReason != null
  );
  if (stopReasonIdx !== -1) {
    return { item: agentChats[stopReasonIdx], index: stopReasonIdx };
  }

  const isNonConsecutiveAgent = (item: PipelineItem) =>
    item.type === "chat" &&
    item.role === "agent" &&
    (item as ChatDisplayItem).originalRole !== "tool" &&
    !item.isConsecutive;
  const ncIdx = agentChats.findIndex(isNonConsecutiveAgent);
  if (ncIdx !== -1) {
    return { item: agentChats[ncIdx], index: ncIdx };
  }

  for (let i = agentChats.length - 1; i >= 0; i--) {
    const item = agentChats[i];
    if (
      item.type === "chat" &&
      item.role === "agent" &&
      (item as ChatDisplayItem).originalRole !== "tool"
    ) {
      return { item, index: i };
    }
  }

  return null;
}

/**
 * Split the latest group's intermediate items for rendering.
 *
 * Before final response (hasFinal=false): peel the last intermediate step
 * out of the banner so the user sees the most recent progress without
 * opening the banner. With 0 or 1 intermediate, nothing is peeled.
 *
 * After final response (hasFinal=true): move ALL intermediates into the
 * banner, show only the final response outside.
 */
export function splitLatestIntermediate(
  allIntermediate: PipelineItem[],
  hasFinal: boolean
): { olderIntermediate: PipelineItem[]; lastIntermediate: PipelineItem | null } {
  if (hasFinal) {
    return { olderIntermediate: allIntermediate, lastIntermediate: null };
  }
  if (allIntermediate.length === 0) {
    return { olderIntermediate: [], lastIntermediate: null };
  }
  return {
    olderIntermediate: allIntermediate.slice(0, -1),
    lastIntermediate: allIntermediate[allIntermediate.length - 1],
  };
}

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

  const isAgentOrToolLatest = (item: PipelineItem) =>
    item.type === "chat" && (item.role === "agent" || item.role === "tool");

  const latestAgentChats = afterLastUser.filter(isAgentOrToolLatest);
  const trailing = afterLastUser.filter((item) => !isAgentOrToolLatest(item));

  const latestFinal = selectFinalResponse(latestAgentChats);
  const latestIntermediate = latestFinal
    ? latestAgentChats.filter((item) => item.key !== latestFinal.item.key)
    : latestAgentChats;

  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    items: latestIntermediate,
    finalResponse: latestFinal,
  };

  const groups: AgentResponseGroup[] = [];
  for (let g = 0; g < userIndices.length - 1; g++) {
    const startIdx = userIndices[g];
    const endIdx = userIndices[g + 1];
    const groupItems = items.slice(startIdx + 1, endIdx);

    const isAgentOrToolInGroup = (item: PipelineItem) =>
      item.type === "chat" && (item.role === "agent" || item.role === "tool");
    const turnAgentChats = groupItems.filter(isAgentOrToolInGroup);
    const final = selectFinalResponse(turnAgentChats);

    const intermediateItems = final
      ? groupItems.filter((item) => item.key !== final.item.key)
      : groupItems;

    groups.push({
      userItem: items[startIdx],
      items: intermediateItems,
      finalResponse: final,
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

  const unreadCount = useSessionUnreadCount(sessionKey);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  const items = useMessagePipeline(rawMessages, sessionId ?? "", agentId ?? "");

  // ── Track new messages for appear animation ─────────────────────
  const prevItemKeysRef = useRef(new Set<string>());
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const isFirstRenderRef = useRef(true);

  const currentKeys = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevItemKeysRef.current = currentKeys;
      setNewKeys(new Set());
      return;
    }
    const prev = prevItemKeysRef.current;
    const added = new Set<string>();
    for (const key of currentKeys) {
      if (!prev.has(key)) added.add(key);
    }
    setNewKeys(added);
    prevItemKeysRef.current = currentKeys;
  }, [currentKeys]);

  useEffect(() => {
    isFirstRenderRef.current = true;
  }, [sessionKey]);

  // ── Count of new items for CSS stagger ──────────────────────────
  const newCount = newKeys.size;

  // ── Group items by user boundary ─────────────────────────────────
  const { groups, latestGroup, trailing } = useMemo(
    () => groupByUserBoundary(items),
    [items]
  );

  // ── Per-group collapse state ─────────────────────────────────────────
  const collapsedMap = useIntermediateStepsCollapseMap(sessionKey ?? null);
  const toggleIntermediateSteps = useToggleIntermediateSteps();

  const prevStreamingRef = useRef(isStreaming);
  const prevRawLenRef = useRef(rawMessages.length);

  const collapsedMapRef = useRef(collapsedMap);
  collapsedMapRef.current = collapsedMap;
  const toggleRef = useRef(toggleIntermediateSteps);
  toggleRef.current = toggleIntermediateSteps;

  const [latestAutoCollapse, setLatestAutoCollapse] = useState(false);
  const prevHasFinalRef = useRef(false);
  const latestGroupRef = useRef(latestGroup);
  latestGroupRef.current = latestGroup;

  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    const group = latestGroupRef.current;
    const hasFinal = group?.finalResponse != null;

    if (prev && !isStreaming && group && sessionKey) {
      const gid = group.userItem.key;
      if (!collapsedMapRef.current[gid]) {
        toggleRef.current(sessionKey, gid);
      }
    }

    if (hasFinal && !prevHasFinalRef.current && !isStreaming) {
      setLatestAutoCollapse(true);
    }
    prevHasFinalRef.current = hasFinal;
  }, [isStreaming, sessionKey]);

  useEffect(() => {
    const currentLen = rawMessages.length;
    const prevLen = prevRawLenRef.current;
    prevRawLenRef.current = currentLen;
    if (currentLen > prevLen) {
      setLatestAutoCollapse(false);
    }
  }, [rawMessages.length]);

  const isGroupExpanded = useCallback(
    (group: AgentResponseGroup): boolean => {
      const gid = group.userItem.key;
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

  // ── Save scroll position on unmount ───────────────────────────────
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

  // ── Auto-advance readUpTo when at bottom ──────────────────────────
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

  // ── Scroll to bottom handler ──────────────────────────────────────
  const handleScrollToBottom = useCallback(() => {
    const wrapper = wrapperRef.current?.querySelector(
      "[data-messages-scroll-container]"
    ) as HTMLDivElement | null;
    if (wrapper) {
      wrapper.scrollTop = wrapper.scrollHeight;
    } else {
      forceScrollToBottomRef?.current?.();
    }
  }, [forceScrollToBottomRef]);

  // ── Sticky user message state ──────────────────────────────────────
  const [stickyUserMessage, setStickyUserMessage] =
    useState<StickyUserMessage | null>(null);
  const stickyUserMessageRef = useRef<StickyUserMessage | null>(null);
  stickyUserMessageRef.current = stickyUserMessage;

  // ── Sticky scroll detection ────────────────────────────────────────
  const updateStickyUserMessage = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const userMessageEls: { key: string; el: HTMLElement }[] = [];
    const allMessages = container.querySelectorAll(
      ".message-user[data-message-id]"
    );
    allMessages.forEach((el) => {
      const key = (el as HTMLElement).dataset.messageId;
      if (key) {
        userMessageEls.push({ key, el: el as HTMLElement });
      }
    });

    const found = findStickyUserMessage(container, userMessageEls);
    if (found?.key !== stickyUserMessageRef.current?.key) {
      setStickyUserMessage(found);
    }
  }, []);

  const handleScrollWithSticky = useCallback(() => {
    handleScroll();
    updateStickyUserMessage();
  }, [handleScroll, updateStickyUserMessage]);

  useEffect(() => {
    requestAnimationFrame(updateStickyUserMessage);
  }, [items.length, updateStickyUserMessage]);

  const handleStickyClick = useCallback(() => {
    if (!stickyUserMessage) return;
    const container = containerRef.current;
    if (!container) return;

    const msgEl = container.querySelector(
      `[data-message-id="${stickyUserMessage.key}"]`
    ) as HTMLElement | null;
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [stickyUserMessage]);

  // ── Render ──────────────────────────────────────────────────────────
  const isEmpty = items.length === 0;
  const showScrollButton = !isAtBottom;
  const showStickyBar = stickyUserMessage !== null && !isEmpty;

  const stickyTime = stickyUserMessage?.timestamp
    ? new Date(stickyUserMessage.timestamp).toLocaleTimeString()
    : "";

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative" ref={wrapperRef}>
      {/* Sticky user message bar */}
      {showStickyBar && stickyUserMessage && (
        <div
          className="sticky top-0 z-10 flex-shrink-0 bg-bg-secondary border-b border-border px-[14px] py-1.5 cursor-pointer transition-colors duration-150 animate-sticky-user-bar-in"
          onClick={handleStickyClick}
          role="button"
          tabIndex={0}
          title="Click to scroll to this message"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStickyClick();
            }
          }}
        >
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[11px] font-medium text-fg-secondary">You</span>
            <span className="text-[10px] text-fg-muted opacity-50">{stickyTime}</span>
          </div>
          <div className="text-xs text-fg-primary whitespace-nowrap overflow-hidden text-ellipsis leading-[1.4]">
            {stickyUserMessage.content}
          </div>
          {stickyUserMessage.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {stickyUserMessage.attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-0.5 px-1 py-px rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-fg-secondary text-[9px] font-mono">
                  {a.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        className={`flex flex-1 min-h-0 overflow-y-auto px-[14px] py-4 flex-col relative${showStickyBar ? " pt-0" : ""}`}
        ref={containerRef}
        onScroll={handleScrollWithSticky}
        data-messages-scroll-container="true"
      >
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-fg-muted">
            <p className="text-base font-medium text-fg-secondary">ACP Chat</p>
            <p className="text-xs">
              {sessionId
                ? "Send a message to start the conversation."
                : "Connect to an agent and create a session to start."}
            </p>
          </div>
        ) : (
          <div
            className={`flex flex-col gap-1.5${isStreaming ? " [&>*:last-child]:animate-blink" : ""}`}
            data-new-count={newCount > 0 ? newCount : undefined}
          >
            {/* Past groups */}
            {groups.map((group) => {
              const expanded = isGroupExpanded(group);
              return (
                <React.Fragment key={group.userItem.key}>
                  <DisplayItemView
                    item={group.userItem}
                    idx={0}
                    items={[group.userItem]}
                    sessionId={sessionId}
                    agentId={agentId}
                    isNew={newKeys.has(group.userItem.key)}
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
                  {group.finalResponse && (
                    <DisplayItemView
                      item={group.finalResponse.item}
                      idx={0}
                      items={[group.finalResponse.item]}
                      sessionId={sessionId}
                      agentId={agentId}
                      forceHeader={true}
                      isNew={newKeys.has(group.finalResponse.item.key)}
                    />
                  )}
                </React.Fragment>
              );
            })}

            {/* Latest group */}
            {latestGroup &&
              (() => {
                const expanded = isGroupExpanded(latestGroup);
                const { olderIntermediate, lastIntermediate } =
                  splitLatestIntermediate(
                    latestGroup.items,
                    latestGroup.finalResponse != null
                  );
                return (
                  <React.Fragment key="latest-group">
                    <DisplayItemView
                      item={latestGroup.userItem}
                      idx={0}
                      items={[latestGroup.userItem]}
                      sessionId={sessionId}
                      agentId={agentId}
                      isNew={newKeys.has(latestGroup.userItem.key)}
                    />
                    {olderIntermediate.length > 0 && (
                      <IntermediateStepsBanner
                        items={olderIntermediate}
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
                    {lastIntermediate && (
                      <DisplayItemView
                        item={lastIntermediate}
                        idx={0}
                        items={[lastIntermediate]}
                        sessionId={sessionId}
                        agentId={agentId}
                        isNew={newKeys.has(lastIntermediate.key)}
                      />
                    )}
                    {latestGroup.finalResponse && (
                      <DisplayItemView
                        item={latestGroup.finalResponse.item}
                        idx={0}
                        items={[latestGroup.finalResponse.item]}
                        sessionId={sessionId}
                        agentId={agentId}
                        forceHeader={true}
                        isNew={newKeys.has(latestGroup.finalResponse.item.key)}
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
                isNew={newKeys.has(item.key)}
              />
            ))}

            {isStreaming && (
              <div className="py-1">
                <span className="inline-block animate-blink text-accent font-bold">▋</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} data-bottom-anchor="true" />
      </div>
      {showScrollButton && (
        <button
          className="absolute bottom-4 right-4 z-10 pointer-events-auto flex items-center justify-center w-8 h-8 p-0 border border-border rounded-full bg-bg-secondary text-fg-primary shadow-[0_2px_8px_rgba(0,0,0,0.3)] cursor-pointer transition-all duration-150 hover:bg-accent-hover hover:border-accent hover:scale-105 active:scale-95"
          onClick={handleScrollToBottom}
          type="button"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <span className="text-sm leading-none">↓</span>
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-4 h-4 px-[3px] rounded-lg bg-accent text-user-fg text-[9px] font-semibold leading-none">{unreadCount}</span>
          )}
        </button>
      )}
    </div>
  );
});
