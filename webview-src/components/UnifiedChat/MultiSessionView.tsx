import React, { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import {
  useSessionStore,
  sessionKeyOf,
} from "../../store/sessionStore";
import type { SessionStoreState } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { useLogger } from "../../hooks/useLogger";
import { SectionHeader } from "./SectionHeader";
import { SectionChatContainer } from "./SectionChatContainer";
import { AgentChip } from "./AgentChip";

// ── Color palette ──────────────────────────────────────────────────────────

const AGENT_COLOR_PALETTE = [
  "#0e639c", // blue
  "#6c20a3", // purple
  "#bf8803", // amber
  "#238636", // green
  "#c44569", // rose
  "#8b5cf6", // violet
  "#0ea5e9", // sky
  "#f97316", // orange
] as const;

function getSessionColor(state: SessionStoreState, sessionKey: string): string {
  const idx = state.tabOrder.indexOf(sessionKey);
  if (idx < 0) return AGENT_COLOR_PALETTE[0];
  return AGENT_COLOR_PALETTE[idx % AGENT_COLOR_PALETTE.length];
}

// ── Single section component (uses useSessionInfo hook) ────────────────────

interface SessionSectionProps {
  sessionKey: string;
  isFocus: boolean;
  isPinned: boolean;
  layoutMode: "single" | "split" | "grid";
  splitRatio: number;
  gridFlexBasis: string | undefined;
  pinnedKeys: string[];
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
}

const SessionSection = React.memo(function SessionSection({
  sessionKey,
  isFocus,
  isPinned,
  layoutMode,
  splitRatio,
  gridFlexBasis,
  onFocusChange,
  onPin,
  onUnpin,
}: SessionSectionProps): React.ReactElement {
  const log = useLogger("SessionSection");
  const info = useSessionInfo(sessionKey);
  const color = getSessionColor(useSessionStore.getState(), sessionKey);
  const messages = useMessageStore.getState().perSession[sessionKey] ?? [];
  const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");

  log.debug("render", {
    sessionKey,
    isFocus,
    isPinned,
    layoutMode,
    hasInfo: !!info,
    messageCount: messages.length,
  });

  // Session disconnected — show placeholder
  if (!info) {
    return (
      <div
        className="unified-session-section unified-session-section--disconnected"
      >
        <div className="unified-section-header">
          <div className="unified-section-header-bar" style={{ borderLeftColor: "#666" }}>
            <span className="unified-section-header-agent">{sessionKey.split(":")[0]}</span>
            <span className="unified-section-header-title" style={{ color: "var(--fg-muted)" }}>
              {sessionKey.split(":")[1]?.slice(0, 8) ?? "unknown"}
            </span>
            <span className="unified-section-header-count" style={{ color: "var(--error)" }}>
              disconnected
            </span>
          </div>
        </div>
        <div className="unified-disconnected-body">
          <p>Session disconnected. Reconnect to the agent to continue.</p>
        </div>
      </div>
    );
  }

  const sectionClassName = [
    "unified-session-section",
    isFocus ? "unified-session-section--focus" : "unified-session-section--pinned",
    info.isStreaming ? "unified-session-section--streaming" : "",
  ].filter(Boolean).join(" ");

  const sectionStyle: React.CSSProperties | undefined = layoutMode === "split"
    ? isFocus
      ? { flex: `0 0 ${splitRatio * 100}%` }
      : { flex: `0 0 ${(1 - splitRatio) * 100}%` }
    : layoutMode === "grid"
      ? { flex: `0 0 ${gridFlexBasis}`, maxWidth: gridFlexBasis }
      : undefined;

  return (
    <div
      className={sectionClassName}
      style={sectionStyle}
    >
      <SectionHeader
        sessionKey={sessionKey}
        agentId={info.agentId}
        title={info.sessionId.slice(0, 8)}
        status={info.status}
        color={color}
        isStreaming={info.isStreaming}
        isTurnActive={info.isStreaming}
        messageCount={messages.length}
        isActive={isFocus}
        isPinned={isPinned}
        onClick={() => onFocusChange(sessionKey)}
        onTogglePin={() => (isPinned ? onUnpin(sessionKey) : onPin(sessionKey))}
      />
      {lastAgentMsg && (
        <AgentChip
          agentId={info.agentId}
          color={color}
          isConsecutive={false}
        />
      )}
      <SectionChatContainer
        sessionKey={sessionKey}
        agentId={info.agentId}
        sessionId={info.sessionId}
        status={info.status}
        isActive={isFocus}
        color={color}
      />
    </div>
  );
});

// ── Props ──────────────────────────────────────────────────────────────────

export interface MultiSessionViewProps {
  focusKey: string | null;
  pinnedKeys: string[];
  layoutMode: "single" | "split" | "grid";
  splitRatio: number;
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onSplitRatioChange: (ratio: number) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const MultiSessionView = React.memo(function MultiSessionView({
  focusKey,
  pinnedKeys,
  layoutMode,
  splitRatio,
  onFocusChange,
  onPin,
  onUnpin,
  onSplitRatioChange,
}: MultiSessionViewProps): React.ReactElement | null {
  const log = useLogger("MultiSessionView");

  const { tabOrder, connectedAgents } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
      connectedAgents: s.connectedAgents,
    }))
  );

  log.debug("render", {
    focusKey,
    pinnedCount: pinnedKeys.length,
    layoutMode,
    splitRatio,
    tabCount: tabOrder.length,
  });

  // ── Divider drag (split mode) ──────────────────────────────────────────

  const dividerRef = React.useRef<HTMLDivElement>(null);
  const isDraggingRef = React.useRef(false);

  const handleDividerMouseDown = useCallback(() => {
    isDraggingRef.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    log.debug("divider drag start");
  }, [log]);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const container = dividerRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      onSplitRatioChange(Math.max(0.2, Math.min(0.8, ratio)));
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onSplitRatioChange]);

  // ── Determine visible sections ────────────────────────────────────────

  const visibleKeys: string[] = [];
  if (layoutMode === "single") {
    if (focusKey) visibleKeys.push(focusKey);
  } else if (layoutMode === "split") {
    if (focusKey) visibleKeys.push(focusKey);
    const firstPinned = pinnedKeys.find((k) => k !== focusKey);
    if (firstPinned) visibleKeys.push(firstPinned);
  } else {
    // grid
    if (focusKey) visibleKeys.push(focusKey);
    for (const k of pinnedKeys) {
      if (k !== focusKey) visibleKeys.push(k);
    }
  }

  if (visibleKeys.length === 0) {
    log.debug("no visible sessions — rendering empty state");
    return (
      <div className="multi-session-view multi-session-view--empty">
        <p>No sessions pinned. Pin a session to see it here.</p>
      </div>
    );
  }

  // ── Grid column count ──────────────────────────────────────────────
  // Auto-adjust columns based on visible section count:
  // 1 → 1 col (100%), 2 → 2 col (50%), 3-4 → 3 col (33%), 5+ → 4 col (25%)
  const gridCols = layoutMode === "grid"
    ? visibleKeys.length <= 1 ? 1 : visibleKeys.length <= 2 ? 2 : visibleKeys.length <= 4 ? 3 : 4
    : 1;
  const gridFlexBasis = layoutMode === "grid" ? `${100 / gridCols}%` : undefined;

  log.debug("visible sections", { keys: visibleKeys, gridCols, gridFlexBasis });

  // ── Render sections ──────────────────────────────────────────────────

  const renderSection = (sessionKey: string, isFocus: boolean) => {
    const isPinned = pinnedKeys.includes(sessionKey);
    return (
      <SessionSection
        key={sessionKey}
        sessionKey={sessionKey}
        isFocus={isFocus}
        isPinned={isPinned}
        layoutMode={layoutMode}
        splitRatio={splitRatio}
        gridFlexBasis={gridFlexBasis}
        pinnedKeys={pinnedKeys}
        onFocusChange={onFocusChange}
        onPin={onPin}
        onUnpin={onUnpin}
      />
    );
  };

  const className = `multi-session-view multi-session-view--${layoutMode}`;

  if (layoutMode === "split") {
    return (
      <div className={className}>
        {visibleKeys.map((key, i) => {
          const isFocus = key === focusKey;
          const section = renderSection(key, isFocus);
          if (i === visibleKeys.length - 1) return section;
          return (
            <React.Fragment key={key}>
              {section}
              <div
                ref={dividerRef}
                className="unified-split-divider"
                onMouseDown={handleDividerMouseDown}
              />
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className={className}>
      {visibleKeys.map((key) => renderSection(key, key === focusKey))}
    </div>
  );
});
