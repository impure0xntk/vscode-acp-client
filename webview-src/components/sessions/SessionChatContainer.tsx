import React, {
  useRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
} from "react";
import { DisplayItemView } from "../message/DisplayItemView";
import { IntermediateStepsBanner } from "../message/IntermediateStepsBanner";
import { StepView } from "../message/StepView";
import { FileEditSummary } from "../message/FileEditSummary";
import { ToolBatchSummary } from "../message/ToolBatchSummary";
import { useMessages } from "../../hooks/useMessages";
import { useMessagePipeline } from "../../hooks/useMessagePipeline";
import { useFileEditSummaryMap } from "../../hooks/useFileEditSummaryMap";
import { useGroupFileEditSummaryMaps } from "../../hooks/useGroupFileEditSummaryMap";
import { useScrollController } from "../../hooks/useScrollController";
import { useSessionUnreadCount } from "../../hooks/useSessionUnreadCount";
import { useScrollStateStore } from "../../store/scrollStateStore";
import { useMessageStore } from "../../store/messageStore";
import {
  useIntermediateStepsCollapseMap,
  useToggleIntermediateSteps,
} from "../../hooks/useIntermediateStepsCollapse";
import type { IntermediateStep, PipelineItem } from "../../pipeline";
import type { ChatDisplayItem } from "../../pipeline/types";
import {
  IntermediateStepGrouper,
  splitLatestSteps,
} from "../../pipeline/stages/grouping";

const SCROLL_BOTTOM_THRESHOLD = 100;

interface StickyUserMessage {
  key: string;
  content: string;
  timestamp: number | undefined;
  attachments: ChatDisplayItem["attachments"];
}

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

import type {
  GroupedItems,
  AgentResponseGroup,
} from "../../pipeline/stages/grouping";

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
  /** Callback when user wants to attach a diff to the composer */
  onAttachDiff?: (attachment: import("../../types").ContextAttachment) => void;
}

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
  onAttachDiff,
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

  const newCount = newKeys.size;

  // Compute grouping without per-step fileEditSummary attachment (phase 1b:
  // attachStepFileEditSummaries is bypassed via setFileEditSummary=false).
  const { leading, groups, latestGroup, trailing } = useMemo(
    () => new IntermediateStepGrouper(items).compute(),
    [items]
  );

  // Per-group file edit summaries via dedicated hook (O(W log W + S)).
  // Computes separate file edit summaries for each group's steps + finalResponse.
  const { groupMaps: groupFileEditSummaryMaps, latestCurrentStepSummary } =
    useGroupFileEditSummaryMaps(
      agentId ?? "",
      sessionId ?? "",
      groups,
      latestGroup
    );

  const collapsedMap = useIntermediateStepsCollapseMap(sessionKey ?? null);
  const toggleIntermediateSteps = useToggleIntermediateSteps();

  const collapsedMapRef = useRef(collapsedMap);
  collapsedMapRef.current = collapsedMap;
  const toggleRef = useRef(toggleIntermediateSteps);
  toggleRef.current = toggleIntermediateSteps;

  // When the current turn completes (its final response settles), collapse
  // the intermediate-steps banner if it was open — so the final message is
  // revealed with the steps already folded.  A layout effect runs before
  // paint, so the banner is already collapsed in the same frame the final
  // message appears (no open-banner flash before collapse).
  //
  // A "settled" final requires a turn-ending stopReason.  During streaming,
  // selectFinalResponse keeps re-selecting the newest agent message (text OR
  // a thinking block) as the "final" even though it has no stopReason yet, so
  // latestFinalKey churns on every chunk/thought.  Collapsing on those
  // spurious changes would hide an expanded banner mid-turn — the reported
  // "banner disappears while the agent is thinking/processing" bug.  We only
  // collapse once the turn actually ends (end_turn, cancelled, max_tokens, …).
  // tool_use is excluded because it continues the same turn.
  const latestFinalKey = latestGroup?.finalResponse?.item.key ?? null;
  const latestFinalStopReason =
    (latestGroup?.finalResponse?.item as ChatDisplayItem | undefined)
      ?.stopReason ?? null;
  const prevFinalKeyRef = useRef<string | null>(null);
  const prevFinalSettledRef = useRef(false);
  useLayoutEffect(() => {
    const key = latestFinalKey;
    const settled =
      latestFinalStopReason != null &&
      latestFinalStopReason !== "" &&
      latestFinalStopReason !== "tool_use";
    const prevKey = prevFinalKeyRef.current;
    const prevSettled = prevFinalSettledRef.current;
    prevFinalKeyRef.current = key;
    prevFinalSettledRef.current = settled;
    if (key == null) return;
    // Collapse only on a genuine turn completion: either the final response is
    // a newly arrived settled message, or the same message just received its
    // turn-ending stopReason.  Streaming jumps between still-open agent
    // messages (no stopReason) must NOT collapse an expanded banner.
    const justSettled = settled && !prevSettled;
    const newSettledFinal = key !== prevKey && settled;
    if (!justSettled && !newSettledFinal) return;
    const gid = latestGroup?.userItem.key;
    if (!gid || !sessionKey) return;
    if (collapsedMapRef.current[gid] === false) {
      toggleRef.current(sessionKey, gid);
    }
  }, [latestFinalKey, latestFinalStopReason, sessionKey]);

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

  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  // Throttle for MutationObserver: skip during streaming, RAF-batch otherwise
  const scrollRafIdRef = useRef<number | null>(null);
  const scrollPendingRef = useRef(false);

  /**
   * Recompute isAtBottom / readUpTo from current DOM state.
   * Called by the scroll handler, the MutationObserver, and the
   * IntermediateStepsBanner onExpandSettled callback so that layout
   * changes caused by intermediate-step toggles are handled identically
   * to user-initiated scrolling.
   *
   * During streaming, scroll state is recomputed at most once per frame
   * to avoid reflow storms from high-frequency DOM mutations.
   */
  const recomputeScrollState = useCallback(() => {
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

  /**
   * Schedule a throttled scroll recompute via RAF.
   * Coalesces multiple calls within a single frame into one execution.
   */
  const scheduleScrollRecompute = useCallback(() => {
    if (scrollRafIdRef.current != null) {
      scrollPendingRef.current = true;
      return;
    }
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollRafIdRef.current = null;
      recomputeScrollState();
      // If more mutations arrived during the frame, schedule another
      if (scrollPendingRef.current) {
        scrollPendingRef.current = false;
        scheduleScrollRecompute();
      }
    });
  }, [recomputeScrollState]);

  const handleScroll = useCallback(() => {
    recomputeScrollState();
  }, [recomputeScrollState]);

  // Track streaming state for MutationObserver suppression
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      // During streaming, scroll state is updated via the message count
      // effect below (msgCountRef) — skip MutationObserver to avoid
      // reflow storms from high-frequency DOM mutations.
      if (isStreamingRef.current) return;
      scheduleScrollRecompute();
    });

    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => observer.disconnect();
  }, [scheduleScrollRecompute]);

  const msgCountRef = useRef(0);
  useEffect(() => {
    if (!sessionKey) return;
    const ids = useMessageStore.getState().perSession[sessionKey];
    const len = ids?.length ?? 0;
    if (len <= msgCountRef.current) return;
    msgCountRef.current = len;
    const store = useScrollStateStore.getState();
    const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;

    if (isAtBottom) {
      store.setReadUpTo(sessionKey, newestId);
    }

    // During streaming, use this effect (triggered by message count change)
    // to update scroll state instead of MutationObserver.  This runs at most
    // once per store update (already RAF-batched by scheduleStreamFlush).
    if (isStreaming) {
      scheduleScrollRecompute();
    }
  }, [
    sessionKey,
    isAtBottom,
    unreadCount,
    isStreaming,
    scheduleScrollRecompute,
  ]);

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

  const [stickyUserMessage, setStickyUserMessage] =
    useState<StickyUserMessage | null>(null);
  const stickyUserMessageRef = useRef<StickyUserMessage | null>(null);
  stickyUserMessageRef.current = stickyUserMessage;

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

  const isEmpty = items.length === 0;
  const showScrollButton = !isAtBottom;
  const showStickyBar = stickyUserMessage !== null && !isEmpty;

  const stickyTime = stickyUserMessage?.timestamp
    ? new Date(stickyUserMessage.timestamp).toLocaleTimeString()
    : "";

  return (
    <div className="flex-1 min-h-0 flex flex-col" ref={wrapperRef}>
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col relative"
        ref={containerRef}
        onScroll={handleScrollWithSticky}
        data-messages-scroll-container="true"
      >
        {/* Sticky user message bar — inside the scroll container so
            `position: sticky; top: 0` pins to the scroll area's top. */}
        {showStickyBar && stickyUserMessage && (
          <div
            className="sticky top-0 z-20 flex-shrink-0 bg-bg-secondary border-b border-border px-3 py-[6px] cursor-pointer transition-colors duration-150 animate-sticky-user-bar-in"
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
            <div className="flex items-center gap-2 mb-[2px]">
              <span className="text-[11px] font-medium text-fg-secondary">
                You
              </span>
              <span className="text-[10px] text-fg-muted opacity-50">
                {stickyTime}
              </span>
            </div>
            <div className="text-xs text-fg-primary whitespace-nowrap overflow-hidden text-ellipsis leading-[1.4]">
              {stickyUserMessage.content}
            </div>
            {stickyUserMessage.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {stickyUserMessage.attachments.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-fg-secondary text-[9px] font-mono"
                  >
                    {a.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3 flex flex-col flex-1 min-h-0">
          {isEmpty ? (
            <div className="min-h-full flex flex-col items-center justify-center text-fg-muted">
              <p className="text-sm font-medium text-fg-secondary">ACP Chat</p>
              <p className="text-xs text-fg-muted max-w-[260px] text-center leading-relaxed mt-1">
                {sessionId
                  ? "Send a message to start the conversation."
                  : "Connect to an agent and create a session to start."}
              </p>
            </div>
          ) : (
            <div
              className={`flex flex-col gap-0.5${isStreaming ? " [&>*:last-child]:animate-blink" : ""}`}
              data-new-count={newCount > 0 ? newCount : undefined}
            >
              {/* Leading items — system notices, compression, etc. before first user message */}
              {leading.map((item, idx) => (
                <DisplayItemView
                  key={item.key}
                  item={item}
                  idx={idx}
                  items={leading}
                  sessionId={sessionId}
                  agentId={agentId}
                  isNew={newKeys.has(item.key)}
                />
              ))}

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
                      steps={group.steps}
                      defaultCollapsed={true}
                      forceExpanded={expanded}
                      sessionId={sessionId}
                      agentId={agentId}
                      onToggle={() =>
                        toggleIntermediateSteps(sessionKey!, group.userItem.key)
                      }
                      onExpandSettled={recomputeScrollState}
                      onAttachDiff={onAttachDiff}
                    />
                    {group.finalResponse && (
                      <>
                        <DisplayItemView
                          item={group.finalResponse.item}
                          idx={0}
                          items={[group.finalResponse.item]}
                          sessionId={sessionId}
                          agentId={agentId}
                          forceHeader={true}
                          isNew={newKeys.has(group.finalResponse.item.key)}
                        />
                        {/* Turn-level file edit summary — only shown as fallback when
                          no per-step fileEditSummary exists in this group's steps.
                          When steps have per-step summaries, they are rendered
                          inside StepView and we suppress the aggregate to avoid duplication. */}
                        {group.turnFileEditSummary &&
                          group.turnFileEditSummary.length > 0 &&
                          !group.steps.some(
                            (s) =>
                              s.fileEditSummary && s.fileEditSummary.length > 0
                          ) && (
                            <FileEditSummary
                              entries={group.turnFileEditSummary}
                              sessionId={sessionId}
                              agentId={agentId}
                              onAttachDiff={onAttachDiff}
                            />
                          )}
                      </>
                    )}
                    {/* Passthrough items — compression, mode_change, etc. that
                      arrived after this group's turn and before the next user
                      message. Rendered after finalResponse to preserve order. */}
                    {group.passthrough.map((item, idx) => (
                      <DisplayItemView
                        key={item.key}
                        item={item}
                        idx={idx}
                        items={group.passthrough}
                        sessionId={sessionId}
                        agentId={agentId}
                        isNew={newKeys.has(item.key)}
                      />
                    ))}
                  </React.Fragment>
                );
              })}

              {/* Latest group */}
              {latestGroup &&
                (() => {
                  const expanded = isGroupExpanded(latestGroup);
                  const { olderSteps, currentStep } = splitLatestSteps(
                    latestGroup.steps,
                    latestGroup.finalResponse != null,
                    latestGroup.currentStep
                  );
                  // Thinking items carried alongside the final step — used to
                  // expand only the latest one by default.
                  const finalThinkingItems = currentStep
                    ? currentStep.toolCalls.filter((tc) => tc.thinking != null)
                    : [];
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
                      {olderSteps.length > 0 && (
                        <IntermediateStepsBanner
                          steps={olderSteps}
                          defaultCollapsed={true}
                          forceExpanded={expanded}
                          sessionId={sessionId}
                          agentId={agentId}
                          onToggle={() =>
                            toggleIntermediateSteps(
                              sessionKey!,
                              latestGroup.userItem.key
                            )
                          }
                          onExpandSettled={recomputeScrollState}
                          onAttachDiff={onAttachDiff}
                          fileEditSummaryMap={groupFileEditSummaryMaps.get(
                            latestGroup.userItem.key
                          )}
                        />
                      )}
                      {currentStep &&
                      latestGroup.finalResponse &&
                      currentStep.agentMessage?.key ===
                        latestGroup.finalResponse.item.key ? (
                        <>
                          <DisplayItemView
                            item={latestGroup.finalResponse.item}
                            idx={0}
                            items={[latestGroup.finalResponse.item]}
                            sessionId={sessionId}
                            agentId={agentId}
                            forceHeader={true}
                            isNew={newKeys.has(
                              latestGroup.finalResponse.item.key
                            )}
                          />
                          {/* Thinking blocks carried alongside the final step
                            render as their own message blocks (not merged into
                            the final response body). The latest thinking block
                            in the final step is expanded by default; earlier
                            ones stay collapsed. */}
                          {finalThinkingItems.map((ti, idx) => {
                            const isLast =
                              idx === finalThinkingItems.length - 1;
                            const thinking = ti.thinking
                              ? { ...ti.thinking, defaultExpanded: isLast }
                              : ti.thinking;
                            return (
                              <DisplayItemView
                                key={ti.key}
                                item={{ ...ti, isFirstOfTurn: false, thinking }}
                                idx={0}
                                items={[ti]}
                                sessionId={sessionId}
                                agentId={agentId}
                                isNew={true}
                                forceHeader={false}
                              />
                            );
                          })}
                          {currentStep.toolCalls.some(
                            (tc) => tc.thinking == null
                          ) && (
                            <div className="ml-4 mr-1 mb-[2px]">
                              <ToolBatchSummary
                                calls={currentStep.toolCalls
                                  .filter((tc) => tc.thinking == null)
                                  .flatMap((tc) => tc.resolvedToolCalls ?? [])}
                                isNew={true}
                              />
                            </div>
                          )}
                          {currentStep.fileEditSummary &&
                            currentStep.fileEditSummary.length > 0 && (
                              <FileEditSummary
                                entries={
                                  latestCurrentStepSummary ??
                                  currentStep.fileEditSummary
                                }
                                sessionId={sessionId}
                                agentId={agentId}
                                onAttachDiff={onAttachDiff}
                              />
                            )}
                        </>
                      ) : (
                        <>
                          {currentStep && (
                            <StepView
                              step={currentStep}
                              isFinalStep={true}
                              sessionId={sessionId}
                              agentId={agentId}
                              isNew={true}
                              forceHeader={true}
                              isAgentNew={
                                currentStep.agentMessage
                                  ? newKeys.has(currentStep.agentMessage.key)
                                  : false
                              }
                              onAttachDiff={onAttachDiff}
                              externalFileEditEntries={groupFileEditSummaryMaps
                                .get(latestGroup.userItem.key)
                                ?.get(olderSteps.length)}
                            />
                          )}
                          {!currentStep && latestGroup.finalResponse && (
                            <DisplayItemView
                              item={latestGroup.finalResponse.item}
                              idx={0}
                              items={[latestGroup.finalResponse.item]}
                              sessionId={sessionId}
                              agentId={agentId}
                              forceHeader={true}
                              isNew={newKeys.has(
                                latestGroup.finalResponse.item.key
                              )}
                            />
                          )}
                          {!currentStep &&
                            latestGroup.finalResponse &&
                            latestGroup.turnFileEditSummary &&
                            latestGroup.turnFileEditSummary.length > 0 && (
                              <FileEditSummary
                                entries={latestGroup.turnFileEditSummary}
                                sessionId={sessionId}
                                agentId={agentId}
                                onAttachDiff={onAttachDiff}
                              />
                            )}
                        </>
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

              {/* Latest group passthrough — compression, mode_change, etc. that
                arrived after the latest turn but before a new user message.
                Rendered at the end to preserve chronological order. */}
              {latestGroup?.passthrough &&
                latestGroup.passthrough.length > 0 &&
                latestGroup.passthrough.map((item, idx) => (
                  <DisplayItemView
                    key={item.key}
                    item={item}
                    idx={idx}
                    items={latestGroup.passthrough}
                    sessionId={sessionId}
                    agentId={agentId}
                    isNew={newKeys.has(item.key)}
                  />
                ))}

              {isStreaming && (
                <div className="py-1">
                  <span className="inline-block animate-blink text-accent font-bold">
                    ▋
                  </span>
                </div>
              )}
            </div>
          )}
          {/* Inside the scroll container so the button stays anchored to the
            message area's bottom regardless of Composer height changes. */}
          {showScrollButton && (
            <div className="sticky bottom-0 z-10 pointer-events-none flex justify-end px-3 pb-2">
              <button
                className="pointer-events-auto relative flex items-center justify-center w-7 h-7 p-0 border border-border rounded-full bg-bg-secondary text-fg-primary shadow-[0_2px_8px_rgba(0,0,0,0.3)] cursor-pointer transition-all duration-150 hover:bg-accent-hover hover:border-accent hover:scale-105 active:scale-95"
                onClick={handleScrollToBottom}
                type="button"
                title="Scroll to bottom"
                aria-label="Scroll to bottom"
              >
                <span className="text-sm leading-none">↓</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[9px] bg-accent text-user-fg text-[10px] font-bold leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]">
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>
          )}
          <div ref={bottomRef} data-bottom-anchor="true" />
        </div>
      </div>
    </div>
  );
});
