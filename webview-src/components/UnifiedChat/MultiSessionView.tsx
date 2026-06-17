import React, { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import {
  useSessionStore,
} from "../../store/sessionStore";
import type { SessionStoreState } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { useLogger } from "../../hooks/useLogger";
import { SectionHeader } from "./SectionHeader";
import { SectionChatContainer } from "./SectionChatContainer";
import { StreamingStatus } from "../StreamingStatus";

import type { ChatMessage } from "../../types";
import type { TurnOutcome } from "../StatusIcon";

// ── Color palette ──────────────────────────────────────────────────────────
// WCAG AA compliant on dark bg (#1e1e1e) — contrast ratio ≥ 4.5:1

const AGENT_COLOR_PALETTE = [
  "hsl(210, 70%, 60%)", // blue
  "hsl(270, 55%, 60%)", // purple
  "hsl(45,  80%, 55%)", // amber
  "hsl(145, 45%, 50%)", // green
  "hsl(345, 60%, 55%)", // rose
  "hsl(195, 75%, 55%)", // sky
  "hsl(25,  80%, 55%)", // orange
  "hsl(320, 50%, 55%)", // pink
] as const;

/** Stable hash-based color — independent of tab order */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getSessionColor(sessionKey: string): string {
  return AGENT_COLOR_PALETTE[hashKey(sessionKey) % AGENT_COLOR_PALETTE.length];
}

// ── Single section component ───────────────────────────────────────────────

interface SessionSectionProps {
  sessionKey: string;
  isFocus: boolean;
  isPinned: boolean;
  layoutMode: "single" | "split" | "grid";
  splitDirection: "vertical" | "horizontal";
  /** Index among visible sections (for split ratio calculation) */
  splitIndex: number;
  /** Total number of visible sections in split mode */
  splitTotal: number;
  /** Per-section split ratios (normalized) */
  splitRatios: number[];
  messages: ChatMessage[];
  tabTitles: Record<string, string>;
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
  scrollToMessageRef?: React.MutableRefObject<((id: string) => void) | undefined>;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
  /** Per-session turn start timestamps (keyed by sessionKey) */
  turnStartedAtMap?: Record<string, string>;
  /** Per-session pending flags (keyed by sessionKey) */
  pendingMap?: Record<string, boolean>;
}

const SessionSection = React.memo(function SessionSection({
  sessionKey,
  isFocus,
  isPinned,
  layoutMode,
  splitDirection,
  splitIndex,
  splitTotal,
  splitRatios,
  messages,
  tabTitles,
  onFocusChange,
  onPin,
  onUnpin,
  onClose,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
}: SessionSectionProps): React.ReactElement | null {
  const log = useLogger("SessionSection");
  const info = useSessionInfo(sessionKey);
  const color = getSessionColor(sessionKey);
  const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");

  // ── Flash on turn completion (mirrors SessionOverviewCard) ─────────
  const prevOutcomeRef = useRef<TurnOutcome | null | undefined>(undefined);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    const prev = prevOutcomeRef.current;
    const current = info?.lastTurnOutcome ?? null;

    if (prev === undefined) {
      prevOutcomeRef.current = current;
      return;
    }

    const isTerminal = current === "completed" || current === "error" || current === "cancelled";
    const isNew = current !== prev;

    if (isTerminal && isNew) {
      setIsFlashing(true);
    }

    prevOutcomeRef.current = current;
  }, [info?.lastTurnOutcome]);

  const handleAnimationEnd = useCallback(() => {
    setIsFlashing(false);
  }, []);

  const flashingStatus = isFlashing ? (info?.lastTurnOutcome ?? info?.status) : undefined;

  // Auto-remove disconnected sessions
  useEffect(() => {
    if (!info) {
      log.info("session disconnected — auto-closing", { sessionKey });
      onClose(sessionKey);
    }
  }, [info, onClose, log, sessionKey]);

  // Don't render anything for disconnected sessions
  if (!info) {
    return null;
  }

  const sectionClassName = [
    "unified-session-section",
    isFocus ? "unified-session-section--focus" : "unified-session-section--pinned",
    info.isStreaming ? "unified-session-section--streaming" : "",
  ].filter(Boolean).join(" ");

  // ── Split flex sizing from splitRatios ───────────────────────────────
  const sectionStyle: React.CSSProperties | undefined = (() => {
    if (layoutMode === "split") {
      const ratio = splitRatios[splitIndex] ?? (1 / splitTotal);
      const pct = ratio * 100;
      if (splitDirection === "horizontal") {
        return { flex: `0 0 ${pct}%`, maxWidth: `${pct}%`, minWidth: "10%" };
      }
      return { flex: `0 0 ${pct}%`, maxHeight: `${pct}%`, minHeight: "10%" };
    }
    if (layoutMode === "grid") {
      const cols = splitTotal <= 1 ? 1 : splitTotal <= 2 ? 2 : splitTotal <= 4 ? 3 : 4;
      const pct = 100 / cols;
      return { flex: `0 0 ${pct}%`, maxWidth: `${pct}%` };
    }
    return undefined;
  })();

  return (
    <div
      className={sectionClassName}
      data-flashing={flashingStatus}
      onAnimationEnd={handleAnimationEnd}
      style={sectionStyle}
    >
      <SectionHeader
        sessionKey={sessionKey}
        agentId={info.agentId}
        title={tabTitles[sessionKey] ?? info.sessionId.slice(0, 8)}
        status={info.status}
        color={color}
        messageCount={messages.length}
        isActive={isFocus}
        isPinned={isPinned}
        splitDirection={splitDirection}
        onClick={() => onFocusChange(sessionKey)}
        onTogglePin={() => (isPinned ? onUnpin(sessionKey) : onPin(sessionKey))}
        onClose={() => onClose(sessionKey)}
        info={info}
      />
      <div
        className="unified-section-chat-wrapper"
        onClick={() => onFocusChange(sessionKey)}
      >
        <SectionChatContainer
          sessionKey={sessionKey}
          agentId={info.agentId}
          sessionId={info.sessionId}
          status={info.status}
          isActive={isFocus}
          color={color}
          scrollToMessageRef={scrollToMessageRef}
          forceScrollToBottomRef={forceScrollToBottomRef}
          scrollToUnreadRef={scrollToUnreadRef}
        />
      </div>
      <StreamingStatus
        sessionKey={sessionKey}
        turnStartedAt={turnStartedAtMap?.[sessionKey]}
        pending={pendingMap?.[sessionKey] ?? false}
      />
    </div>
  );
});

// ── Props ──────────────────────────────────────────────────────────────────

export interface MultiSessionViewProps {
  focusKey: string | null;
  pinnedKeys: string[];
  layoutMode: "single" | "split" | "grid";
  splitDirection: "vertical" | "horizontal";
  splitRatios: number[];
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
  onSplitRatiosChange: (ratios: number[]) => void;
  scrollToMessageRef?: React.MutableRefObject<((id: string) => void) | undefined>;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
  /** Per-session turn start timestamps (keyed by sessionKey) */
  turnStartedAtMap?: Record<string, string>;
  /** Per-session pending flags (keyed by sessionKey) */
  pendingMap?: Record<string, boolean>;
}

// ── Component ──────────────────────────────────────────────────────────────

export const MultiSessionView = React.memo(function MultiSessionView({
  focusKey,
  pinnedKeys,
  layoutMode,
  splitDirection,
  splitRatios,
  onFocusChange,
  onPin,
  onUnpin,
  onClose,
  onSplitRatiosChange,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
}: MultiSessionViewProps): React.ReactElement | null {
  const log = useLogger("MultiSessionView");

  const { tabOrder, connectedAgents, tabTitles } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
      connectedAgents: s.connectedAgents,
      tabTitles: s.tabTitles,
    }))
  );

  // ── Determine visible sections ────────────────────────────────────────
  // Preserve pinnedKeys order so that clicking a session to focus it
  // does NOT change its visual position in the split layout.
  const visibleKeys: string[] = [];
  if (layoutMode === "single") {
    if (focusKey) visibleKeys.push(focusKey);
  } else {
    for (const k of pinnedKeys) {
      visibleKeys.push(k);
    }
    // If focusKey is not yet in pinnedKeys (e.g. just connected), append it
    if (focusKey && !pinnedKeys.includes(focusKey)) {
      visibleKeys.push(focusKey);
    }
  }

  // ── Divider drag state ────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    dividerIndex: number;
    startPos: number;
    startRatios: number[];
  } | null>(null);

  const handleDividerMouseDown = useCallback(
    (dividerIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      // Ensure splitRatios has enough entries for all visible sections
      const currentRatios = splitRatios.length >= visibleKeys.length
        ? [...splitRatios]
        : Array(visibleKeys.length).fill(1 / visibleKeys.length);
      dragStateRef.current = {
        dividerIndex,
        startPos: splitDirection === "horizontal" ? e.clientX : e.clientY,
        startRatios: currentRatios,
      };
      document.body.style.cursor = splitDirection === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      log.debug("divider drag start", { dividerIndex });
    },
    [splitDirection, splitRatios, visibleKeys.length, log],
  );

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pos = splitDirection === "horizontal" ? e.clientX : e.clientY;
      const startPos = drag.startPos;
      const totalSize = splitDirection === "horizontal" ? rect.width : rect.height;
      const delta = (pos - startPos) / totalSize;

      const newRatios = [...drag.startRatios];
      const i = drag.dividerIndex;
      const minRatio = 0.1;
      // Adjust divider between section i and i+1
      const newI = Math.max(minRatio, Math.min(1 - minRatio, newRatios[i] + delta));
      const d = newI - newRatios[i];
      newRatios[i] = newI;
      if (i + 1 < newRatios.length) {
        newRatios[i + 1] = Math.max(minRatio, newRatios[i + 1] - d);
      }
      // Renormalize to sum to 1
      const sum = newRatios.reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (let j = 0; j < newRatios.length; j++) {
          newRatios[j] /= sum;
        }
      }
      onSplitRatiosChange(newRatios);
    };
    const handleMouseUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [splitDirection, onSplitRatiosChange]);

  if (visibleKeys.length === 0) {
    log.debug("no visible sessions — rendering empty state");
    return (
      <div className="multi-session-view multi-session-view--empty">
        <p>No sessions pinned. Pin a session to see it here.</p>
      </div>
    );
  }

  // ── Grid column count ──────────────────────────────────────────────
  const gridCols = layoutMode === "grid"
    ? visibleKeys.length <= 1 ? 1 : visibleKeys.length <= 2 ? 2 : visibleKeys.length <= 4 ? 3 : 4
    : 1;

  // ── Render sections ──────────────────────────────────────────────────

  // Read messages once per render cycle — avoids per-section getState() calls
  // that create new references on every parent re-render.
  const allMessages = useMessageStore.getState().perSession;

  /** Effective ratios: use stored ratios if they match visible count,
   *  otherwise fall back to equal distribution. */
  const effectiveRatios = splitRatios.length >= visibleKeys.length
    ? splitRatios
    : Array(visibleKeys.length).fill(1 / visibleKeys.length);

  const renderSection = (sessionKey: string, isFocus: boolean) => {
    const isPinned = pinnedKeys.includes(sessionKey);
    const idx = visibleKeys.indexOf(sessionKey);
    return (
      <SessionSection
        key={sessionKey}
        sessionKey={sessionKey}
        isFocus={isFocus}
        isPinned={isPinned}
        layoutMode={layoutMode}
        splitDirection={splitDirection}
        splitIndex={idx}
        splitTotal={visibleKeys.length}
        splitRatios={effectiveRatios}
        messages={allMessages[sessionKey] ?? []}
        tabTitles={tabTitles}
        turnStartedAtMap={turnStartedAtMap}
        pendingMap={pendingMap}
        onFocusChange={onFocusChange}
        onPin={onPin}
        onUnpin={onUnpin}
        onClose={onClose}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
      />
    );
  };

  const containerClassName = [
    "multi-session-view",
    `multi-session-view--${layoutMode}`,
    layoutMode === "split" && splitDirection === "horizontal"
      ? "multi-session-view--split-horizontal"
      : layoutMode === "split"
        ? "multi-session-view--split-vertical"
        : "",
  ].filter(Boolean).join(" ");

  // ── Render with dividers for split mode ─────────────────────────────

  if (layoutMode === "split") {
    return (
      <div className="multi-session-view-wrapper">
        <div className={containerClassName} ref={containerRef}>
          {visibleKeys.map((key, i) => {
            const isFocus = key === focusKey;
            const section = renderSection(key, isFocus);
            if (i === visibleKeys.length - 1) return section;
            return (
              <React.Fragment key={key}>
                {section}
                <div
                  className={`unified-split-divider unified-split-divider--${splitDirection}`}
                  onMouseDown={handleDividerMouseDown(i)}
                />
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={containerClassName} ref={containerRef}>
      {visibleKeys.map((key) => renderSection(key, key === focusKey))}
    </div>
  );
});
