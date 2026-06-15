import React, { useCallback, useRef } from "react";
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
  pinnedKeys: string[];
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
}

const SessionSection = React.memo(function SessionSection({
  sessionKey,
  isFocus,
  isPinned,
  layoutMode,
  splitDirection,
  splitIndex,
  splitTotal,
  onFocusChange,
  onPin,
  onUnpin,
  onClose,
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

  // ── Split flex sizing ────────────────────────────────────────────────
  // Each section gets equal share. Divider drag adjusts via CSS custom
  // property set on the container, but for simplicity we use equal flex
  // and rely on the container's --split-ratios custom property.
  const sectionStyle: React.CSSProperties | undefined = (() => {
    if (layoutMode === "split") {
      // Equal distribution; divider drag adjusts container-level ratios
      const pct = 100 / splitTotal;
      return splitDirection === "horizontal"
        ? { flex: `1 1 ${pct}%`, maxWidth: `${pct}%` }
        : { flex: `1 1 ${pct}%`, maxHeight: `${pct}%` };
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
        onClose={() => onClose(sessionKey)}
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
  splitDirection: "vertical" | "horizontal";
  splitRatios: number[];
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
  onSplitRatiosChange: (ratios: number[]) => void;
  onSplitDirectionChange: (dir: "vertical" | "horizontal") => void;
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
  onSplitDirectionChange,
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
    splitDirection,
    tabCount: tabOrder.length,
  });

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
      dragStateRef.current = {
        dividerIndex,
        startPos: splitDirection === "horizontal" ? e.clientX : e.clientY,
        startRatios: [...splitRatios],
      };
      document.body.style.cursor = splitDirection === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      log.debug("divider drag start", { dividerIndex });
    },
    [splitDirection, splitRatios, log],
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
      // Adjust the two ratios adjacent to the divider
      const i = drag.dividerIndex;
      const minRatio = 0.1;
      const newUpper = Math.max(minRatio, Math.min(1 - minRatio, newRatios[i] + delta));
      const deltaUpper = newUpper - newRatios[i];
      newRatios[i] = newUpper;
      if (i + 1 < newRatios.length) {
        newRatios[i + 1] = Math.max(minRatio, newRatios[i + 1] - deltaUpper);
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

  // ── Determine visible sections ────────────────────────────────────────

  const visibleKeys: string[] = [];
  if (layoutMode === "single") {
    if (focusKey) visibleKeys.push(focusKey);
  } else {
    // split / grid: show focus + all pinned (excluding focus duplicate)
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
  const gridCols = layoutMode === "grid"
    ? visibleKeys.length <= 1 ? 1 : visibleKeys.length <= 2 ? 2 : visibleKeys.length <= 4 ? 3 : 4
    : 1;

  log.debug("visible sections", { keys: visibleKeys, gridCols });

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
        splitDirection={splitDirection}
        splitIndex={visibleKeys.indexOf(sessionKey)}
        splitTotal={visibleKeys.length}
        pinnedKeys={pinnedKeys}
        onFocusChange={onFocusChange}
        onPin={onPin}
        onUnpin={onUnpin}
        onClose={onClose}
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

  // ── Split direction toggle ──────────────────────────────────────────

  const directionToggle = layoutMode === "split" && (
    <div className="unified-split-direction-toggle">
      <button
        className={`unified-split-dir-btn${splitDirection === "vertical" ? " unified-split-dir-btn--active" : ""}`}
        onClick={() => onSplitDirectionChange("vertical")}
        type="button"
        title="Vertical split (stacked)"
      >
        ↕
      </button>
      <button
        className={`unified-split-dir-btn${splitDirection === "horizontal" ? " unified-split-dir-btn--active" : ""}`}
        onClick={() => onSplitDirectionChange("horizontal")}
        type="button"
        title="Horizontal split (side by side)"
      >
        ↔
      </button>
    </div>
  );

  // ── Render with dividers for split mode ─────────────────────────────

  if (layoutMode === "split") {
    return (
      <div className="multi-session-view-wrapper">
        {directionToggle}
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
