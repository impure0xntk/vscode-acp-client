import React, { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useLogger } from "../../hooks/useLogger";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import type { SessionStoreState, SessionTabState, SessionInfoDTO } from "../../store/sessionStore";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { StatusIcon } from "../StatusIcon";
import type { StatusIconType, TurnOutcome } from "../StatusIcon";
import { UnreadBadge } from "../ui/UnreadBadge";
import { IconPinFilled, IconClose, IconLayoutGrid, IconLayoutList } from "../../lib/icons";
import { UnifiedSessionOverviewCard } from "./UnifiedSessionOverviewCard";

// ============================================================================
// UnifiedSessionBar — session tab bar for UnifiedChatPanel
//
// Two display modes:
//   "tabs"  — compact horizontal tabs (Classic SessionTab style)
//   "cards" — SessionOverviewCard-based cards with live status, chips, previews
//
// Includes a "+" button with session picker dropdown.
// ============================================================================

interface UnifiedSessionBarProps {
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  pinnedSessionKeys: string[];
  connectedAgents: { agentId: string; color?: string }[];
  onFocusChange: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: (key: string) => void;
}

// ── Display mode type ──────────────────────────────────────────────────────

type BarDisplayMode = "tabs" | "cards";

// ── Single tab component (compact, Classic SessionTab style) ────────────────

interface UnifiedTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isPinned: boolean;
  agentColor?: string;
  unreadCount: number;
  onClick: () => void;
  onClose: () => void;
}

const UnifiedTab = React.memo(function UnifiedTab({
  tab,
  isActive,
  isPinned,
  agentColor,
  unreadCount,
  onClick,
  onClose,
}: UnifiedTabProps): React.ReactElement {
  const sessionKey = sessionKeyOf(tab.agentId, tab.sessionId);
  const info = useSessionInfo(sessionKey);
  const [isHovered, setIsHovered] = useState(false);

  const rawStatus = info?.status ?? "idle";
  const lastOutcome: TurnOutcome | null = info?.lastTurnOutcome ?? null;

  const effectiveStatus: StatusIconType =
    rawStatus === "running"
      ? "running"
      : rawStatus === "idle" && lastOutcome
        ? lastOutcome
        : rawStatus === "idle"
          ? "idle"
          : rawStatus;

  const elapsedMs =
    rawStatus === "running" && info?.lastResponseAt
      ? Date.now() - new Date(info.lastResponseAt).getTime()
      : undefined;

  const showClose = isActive || isHovered;

  return (
    <div
      className={`unified-session-bar-tab${isActive ? " unified-session-bar-tab--active" : ""}${isHovered ? " unified-session-bar-tab--hovered" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <StatusIcon status={effectiveStatus} elapsedMs={elapsedMs} size="sm" />
      <span
        className="unified-session-bar-tab-agent"
        style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
        title={tab.agentId}
      >
        {tab.agentId}
      </span>
      <span className="unified-session-bar-tab-title" title={tab.title}>
        {tab.title.length > 12 ? `${tab.title.slice(0, 12)}…` : tab.title}
      </span>
      {isPinned && <IconPinFilled size={10} className="unified-session-bar-tab-pin" title="Pinned" />}
      <UnreadBadge count={unreadCount} hidden={isActive} className="unified-session-bar-tab-badge" />
      {showClose && (
        <button
          className="unified-session-bar-tab-close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close"
          type="button"
        >
          <IconClose size={12} />
        </button>
      )}
    </div>
  );
});

// ── Bar container ──────────────────────────────────────────────────────────

export const UnifiedSessionBar = React.memo(function UnifiedSessionBar({
  tabs,
  activeSessionKey,
  pinnedSessionKeys,
  connectedAgents,
  onFocusChange,
  onClose,
  onAdd,
}: UnifiedSessionBarProps): React.ReactElement {
  const log = useLogger("UnifiedSessionBar");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<BarDisplayMode>("tabs");
  const pickerRef = useRef<HTMLDivElement>(null);

  const { tabOrder } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
    }))
  );

  // Sessions not yet in the bar
  const availableSessions = useMemo(
    () => tabOrder.filter((key) => !tabs.some((t) => sessionKeyOf(t.agentId, t.sessionId) === key)),
    [tabOrder, tabs]
  );

  const handleAddClick = useCallback(() => {
    log.info("session bar add — opening picker");
    setPickerOpen(true);
  }, [log]);

  const handlePickSession = useCallback(
    (key: string) => {
      log.info("session picked", { key });
      setPickerOpen(false);
      onAdd(key);
    },
    [onAdd, log]
  );

  const toggleDisplayMode = useCallback(() => {
    setDisplayMode((prev) => (prev === "tabs" ? "cards" : "tabs"));
    log.debug("display mode toggle", { mode: displayMode === "tabs" ? "cards" : "tabs" });
  }, [displayMode, log]);

  // Close picker on outside click
  React.useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  return (
    <div className="unified-session-bar">
      {/* Session tabs / cards */}
      <div className={`unified-session-bar-scroll unified-session-bar-scroll--${displayMode}`}>
        {displayMode === "tabs" ? (
          // ── Tabs mode ─────────────────────────────────────────────
          tabs.map((tab) => {
            const key = sessionKeyOf(tab.agentId, tab.sessionId);
            const isActive = key === activeSessionKey;
            const isPinned = pinnedSessionKeys.includes(key);
            const agent = connectedAgents.find((a) => a.agentId === tab.agentId);

            return (
              <UnifiedTab
                key={key}
                tab={tab}
                isActive={isActive}
                isPinned={isPinned}
                agentColor={agent?.color}
                unreadCount={0}
                onClick={() => {
                  log.debug("tab click", { key });
                  onFocusChange(key);
                }}
                onClose={() => onClose(key)}
              />
            );
          })
        ) : (
          // ── Cards mode ────────────────────────────────────────────
          tabs.map((tab) => {
            const key = sessionKeyOf(tab.agentId, tab.sessionId);
            const isActive = key === activeSessionKey;
            const isPinned = pinnedSessionKeys.includes(key);
            const agent = connectedAgents.find((a) => a.agentId === tab.agentId);

            return (
              <UnifiedSessionOverviewCard
                key={key}
                sessionKey={key}
                isActive={isActive}
                isPinned={isPinned}
                agentColor={agent?.color}
                unreadCount={0}
                onClick={(k) => {
                  log.debug("card click → focus", { key: k });
                  onFocusChange(k);
                }}
                onClose={onClose}
              />
            );
          })
        )}
      </div>

      {/* Display mode toggle */}
      <button
        className="unified-session-bar-mode-toggle"
        onClick={toggleDisplayMode}
        type="button"
        title={displayMode === "tabs" ? "Switch to card view" : "Switch to tab view"}
      >
        {displayMode === "tabs" ? <IconLayoutGrid size={14} /> : <IconLayoutList size={14} />}
      </button>

      {/* Add session button + picker */}
      <div className="unified-session-bar-add" ref={pickerRef}>
        <button
          className="unified-session-bar-add-btn"
          onClick={handleAddClick}
          type="button"
          title="Add session"
        >
          +
        </button>
        {pickerOpen && (
          <div className="session-chips-picker">
            {availableSessions.length === 0 ? (
              <div className="session-chips-picker-empty">No more sessions to add</div>
            ) : (
              availableSessions.map((key) => {
                const [agentId, sessionId] = key.split(":");
                const agent = connectedAgents.find((a) => a.agentId === agentId);
                return (
                  <button
                    key={key}
                    className="session-chips-picker-item"
                    onClick={() => handlePickSession(key)}
                    type="button"
                  >
                    <span
                      className="session-chips-picker-dot"
                      style={{ backgroundColor: agent?.color ?? "#0e639c" }}
                    />
                    <span className="session-chips-picker-agent">{agentId}</span>
                    <span className="session-chips-picker-session">{sessionId.slice(0, 12)}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
});
