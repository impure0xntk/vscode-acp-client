import React, {
  useCallback,
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { getLogger } from "../../lib/logger";

const log = getLogger("webview.SessionTabBar");
import type {
  SessionTabState,
  ConnectedAgentInfo,
} from "../../store/sessionStore";
import type { SessionOverviewItem } from "../../types";
import { useScrollStateStore } from "../../store/scrollStateStore";
import { useMessageStore } from "../../store/messageStore";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { SessionTab } from "./SessionTab";
import { SessionOverviewPopup } from "./overview/SessionOverviewPopup";
import { StatusIcon } from "../primitives/StatusIcon";
import type { StatusIconType, TurnOutcome } from "../primitives/StatusIcon";
import { UnreadBadge } from "../primitives/UnreadBadge";
import { IconClose, IconPin, IconPinFilled } from "../../lib/icons";
import { useSessionInfo } from "../../hooks/useSessionInfo";

/** Delay before showing popup after hover (ms) */
const HOVER_SHOW_DELAY = 300;
/** Delay before hiding popup after mouse leaves (ms) */
const HOVER_HIDE_DELAY = 200;

// ============================================================================
// SessionTabBarProps — merged props interface
// ============================================================================

export interface SessionTabBarProps {
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  connectedAgents: ConnectedAgentInfo[];
  overviewItems: Record<string, SessionOverviewItem>;
  onTabClick: (sessionKey: string) => void;
  onTabClose: (sessionKey: string) => void;
  onTabReorder: (tabs: SessionTabState[]) => void;
  onNewSession: () => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  // Unified mode extensions:
  pinnedSessionKeys?: string[];
  onTogglePin?: (key: string) => void;
  layoutMode?: "single" | "split" | "grid";
  splitDirection?: "vertical" | "horizontal";
  onLayoutChange?: (mode: "single" | "split" | "grid") => void;
  onSplitDirectionChange?: (dir: "vertical" | "horizontal") => void;
}

// ============================================================================
// Classic Mode Tab Bar (from SessionTabs)
// ============================================================================

interface ClassicTabBarProps {
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  connectedAgents: ConnectedAgentInfo[];
  overviewItems: Record<string, SessionOverviewItem>;
  onTabClick: (sessionKey: string) => void;
  onTabClose: (sessionKey: string) => void;
  onTabReorder: (tabs: SessionTabState[]) => void;
  onNewSession: () => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
}

function ClassicTabBar({
  tabs,
  activeSessionKey,
  connectedAgents,
  overviewItems,
  onTabClick,
  onTabClose,
  onTabReorder,
  onNewSession,
  onRenameSession,
}: ClassicTabBarProps): React.ReactElement {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoveredTabKey, setHoveredTabKey] = useState<string | null>(null);
  const [popupSession, setPopupSession] = useState<{
    agentId: string;
    sessionId: string;
    rect: DOMRect;
  } | null>(null);

  const hoverShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (hoverShowTimer.current) {
      clearTimeout(hoverShowTimer.current);
      hoverShowTimer.current = null;
    }
    if (hoverHideTimer.current) {
      clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Clear hover state when the hovered session is removed from tabs
  useEffect(() => {
    if (
      hoveredTabKey !== null &&
      !tabs.some((t) => sessionKeyOf(t.agentId, t.sessionId) === hoveredTabKey)
    ) {
      setHoveredTabKey(null);
    }
  }, [hoveredTabKey, tabs]);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    log.debug("tab drag start", { index });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== targetIndex) {
        const newTabs = [...tabs];
        const [moved] = newTabs.splice(dragIndex, 1);
        newTabs.splice(targetIndex, 0, moved);
        log.info("tab reorder", {
          from: dragIndex,
          to: targetIndex,
          tab: sessionKeyOf(moved.agentId, moved.sessionId),
        });
        onTabReorder(newTabs);
      }
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, tabs, onTabReorder]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const handleTabMouseEnter = useCallback(
    (e: React.MouseEvent, tab: SessionTabState) => {
      clearTimers();
      setHoveredTabKey(sessionKeyOf(tab.agentId, tab.sessionId));
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      hoverShowTimer.current = setTimeout(() => {
        setPopupSession({
          agentId: tab.agentId,
          sessionId: tab.sessionId,
          rect,
        });
      }, HOVER_SHOW_DELAY);
    },
    [clearTimers]
  );

  const handleTabMouseLeave = useCallback(() => {
    clearTimers();
    hoverHideTimer.current = setTimeout(() => {
      setHoveredTabKey(null);
      setPopupSession(null);
    }, HOVER_HIDE_DELAY);
  }, [clearTimers]);

  const handlePopupMouseEnter = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  const handlePopupMouseLeave = useCallback(() => {
    clearTimers();
    setHoveredTabKey(null);
    setPopupSession(null);
  }, [clearTimers]);

  // Derive unread counts from scrollStateStore + messageStore.
  const tabKeys = useMemo(
    () => tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId)).join(","),
    [tabs]
  );
  const unreadMap = useMemo(() => {
    const scrollStore = useScrollStateStore.getState();
    const msgStore = useMessageStore.getState();
    const map = new Map<string, number>();
    for (const tab of tabs) {
      const key = sessionKeyOf(tab.agentId, tab.sessionId);
      const scrollState = scrollStore.perSession[key];
      const msgs = msgStore.perSession[key] ?? [];
      const totalCount = msgs.length;

      if (!scrollState || totalCount === 0) {
        map.set(key, 0);
        continue;
      }

      const { readUpToMessageId, isAtBottom } = scrollState;
      if (isAtBottom || !readUpToMessageId) {
        map.set(key, 0);
        continue;
      }

      const idx = msgs.findIndex((m) => m.id === readUpToMessageId);
      if (idx < 0 || idx + 1 >= totalCount) {
        map.set(key, 0);
        continue;
      }

      map.set(key, totalCount - idx - 1);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKeys]);

  return (
    <div className="flex items-stretch bg-bg-secondary shrink-0 overflow-hidden">
      <div className="flex items-stretch overflow-x-auto flex-1">
        {tabs.map((tab, index) => {
          const key = sessionKeyOf(tab.agentId, tab.sessionId);
          const isActive = key === activeSessionKey;
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== index;
          const isHovered = hoveredTabKey === key;

          const unread = unreadMap.get(key) ?? 0;
          const agentColor = connectedAgents.find(
            (a) => a.agentId === tab.agentId
          )?.color;

          return (
            <div
              key={key}
              style={{ display: "contents" }}
              draggable={isDragging}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <SessionTab
                tab={tab}
                isActive={isActive}
                isHovered={isHovered}
                agentColor={agentColor}
                unreadCount={unread}
                onClick={() => {
                  log.debug("tab click", {
                    agentId: tab.agentId,
                    sessionId: tab.sessionId,
                    key,
                  });
                  onTabClick(key);
                }}
                onClose={() => {
                  log.info("tab close", {
                    agentId: tab.agentId,
                    sessionId: tab.sessionId,
                    key,
                  });
                  onTabClose(key);
                }}
                onMouseEnter={(e) => handleTabMouseEnter(e, tab)}
                onMouseLeave={handleTabMouseLeave}
                onRename={onRenameSession}
              />
            </div>
          );
        })}
      </div>
      <button
        className="shrink-0 flex items-center justify-center w-7 h-full min-h-[32px] border-none bg-transparent text-fg-secondary text-base cursor-pointer transition-colors duration-150 hover:text-fg-primary"
        onClick={onNewSession}
        title="New session"
      >
        +
      </button>

      {/* Overview popup on tab hover */}
      {popupSession &&
        overviewItems[`${popupSession.agentId}:${popupSession.sessionId}`] && (
          <div
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          >
            <SessionOverviewPopup
              session={
                overviewItems[
                  `${popupSession.agentId}:${popupSession.sessionId}`
                ]
              }
              anchorRect={popupSession.rect}
            />
          </div>
        )}
    </div>
  );
}

// ============================================================================
// Unified Mode Session Bar (from UnifiedSessionBar)
// ============================================================================

type LayoutMode = "single" | "split" | "grid";

interface UnifiedTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isPinned: boolean;
  agentColor?: string;
  unreadCount: number;
  onClick: () => void;
  onClose: () => void;
  onTogglePin: () => void;
}

const UnifiedTab = React.memo(function UnifiedTab({
  tab,
  isActive,
  isPinned,
  agentColor,
  unreadCount,
  onClick,
  onClose,
  onTogglePin,
}: UnifiedTabProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const sessionKey = sessionKeyOf(tab.agentId, tab.sessionId);
  const info = useSessionInfo(sessionKey);

  // Local tick for elapsedMs — recompute every second while running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (info?.status !== "running" || !info?.lastResponseAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [info?.status, info?.lastResponseAt]);

  const rawStatus = info?.status ?? "idle";
  const lastOutcome: TurnOutcome | null = info?.lastTurnOutcome ?? null;

  const status: StatusIconType =
    rawStatus === "running"
      ? "running"
      : rawStatus === "idle" && lastOutcome
        ? lastOutcome
        : rawStatus === "idle"
          ? "idle"
          : rawStatus;

  const elapsedMs =
    status === "running" && info?.lastResponseAt
      ? Date.now() - new Date(info.lastResponseAt).getTime()
      : undefined;

  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-1 border border-transparent rounded bg-transparent text-fg-secondary text-[11px] whitespace-nowrap cursor-pointer shrink-0 transition-all duration-150${isActive ? " bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-fg-primary" : ""}${isHovered ? " bg-accent-hover" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{ borderLeft: `3px solid ${agentColor ?? "transparent"}` }}
    >
      <StatusIcon status={status} elapsedMs={elapsedMs} />
      <span
        className="font-semibold font-mono text-[11px] shrink-0"
        style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
        title={tab.agentId}
      >
        {tab.agentId}
      </span>
      <span className="max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap shrink min-w-0 text-[11px] text-fg-secondary" title={tab.title}>
        {tab.title.length > 12 ? `${tab.title.slice(0, 12)}…` : tab.title}
      </span>
      {/* Pin button — clickable, toggles pin state */}
      <button
        className="shrink-0 w-[18px] h-[18px] inline-flex items-center justify-center p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer transition-all duration-150 opacity-70 hover:bg-accent-hover hover:text-fg-primary"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={isPinned ? "Unpin session" : "Pin session"}
        type="button"
      >
        {isPinned ? (
          <IconPinFilled size={12} />
        ) : (
          <IconPin size={12} className="opacity-25" />
        )}
      </button>
      <UnreadBadge
        count={unreadCount}
        hidden={isActive}
        className="shrink-0"
      />
      {/* Close button — always reserves space; visibility toggled via CSS */}
      <button
        className={`inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer shrink-0 transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:text-error ${isActive || isHovered ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close"
        type="button"
      >
        <IconClose size={12} />
      </button>
    </div>
  );
});

interface UnifiedTabBarProps {
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  pinnedSessionKeys: string[];
  connectedAgents: { agentId: string; color?: string }[];
  onTabClick: (key: string) => void;
  onTabClose: (key: string) => void;
  onTogglePin: (key: string) => void;
  onNewSession: () => void;
  layoutMode: LayoutMode;
  splitDirection: "vertical" | "horizontal";
  onLayoutChange: (mode: LayoutMode) => void;
  onSplitDirectionChange: (dir: "vertical" | "horizontal") => void;
}

function UnifiedTabBar({
  tabs,
  activeSessionKey,
  pinnedSessionKeys,
  connectedAgents,
  onTabClick,
  onTabClose,
  onTogglePin,
  onNewSession,
  layoutMode,
  splitDirection,
  onLayoutChange,
  onSplitDirectionChange,
}: UnifiedTabBarProps): React.ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1 p-[4px 8px] overflow-x-auto bg-bg-secondary border-b border-border">
      <div className="flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
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
              onClick={() => onTabClick(key)}
              onClose={() => onTabClose(key)}
              onTogglePin={() => onTogglePin(key)}
            />
          );
        })}
      </div>

      {/* Layout mode toggle — right edge of session bar */}
      <div
        className="inline-flex items-center gap-px shrink-0 ml-1 border-l border-border pl-1"
        role="group"
        aria-label="Layout mode"
      >
        <button
          className={`inline-flex items-center justify-center w-[22px] h-[22px] p-0 border border-transparent rounded-[3px] bg-transparent text-fg-muted text-xs leading-none cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent-hover hover:text-fg-secondary${layoutMode === "single" ? " text-fg-primary bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]" : ""}`}
          onClick={() => onLayoutChange("single")}
          type="button"
          title="Single view"
        >
          1
        </button>
        <button
          className={`inline-flex items-center justify-center w-[22px] h-[22px] p-0 border border-transparent rounded-[3px] bg-transparent text-fg-muted text-xs leading-none cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent-hover hover:text-fg-secondary${layoutMode === "split" && splitDirection === "horizontal" ? " text-fg-primary bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]" : ""}`}
          onClick={() => {
            onLayoutChange("split");
            onSplitDirectionChange("horizontal");
          }}
          type="button"
          title="Side by side"
        >
          ║
        </button>
        <button
          className={`inline-flex items-center justify-center w-[22px] h-[22px] p-0 border border-transparent rounded-[3px] bg-transparent text-fg-muted text-xs leading-none cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent-hover hover:text-fg-secondary${layoutMode === "split" && splitDirection === "vertical" ? " text-fg-primary bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]" : ""}`}
          onClick={() => {
            onLayoutChange("split");
            onSplitDirectionChange("vertical");
          }}
          type="button"
          title="Stacked"
        >
          ═
        </button>
        <button
          className={`inline-flex items-center justify-center w-[22px] h-[22px] p-0 border border-transparent rounded-[3px] bg-transparent text-fg-muted text-xs leading-none cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent-hover hover:text-fg-secondary${layoutMode === "grid" ? " text-fg-primary bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]" : ""}`}
          onClick={() => onLayoutChange("grid")}
          type="button"
          title="Grid view"
        >
          ▦
        </button>
      </div>

      {/* Separator between layout toggle and session actions */}
      <div className="shrink-0 w-px h-3 bg-border mx-1" aria-hidden="true" />

      {/* New session button */}
      <button
        className="shrink-0 flex items-center justify-center w-7 h-full min-h-[32px] border-none bg-transparent text-fg-secondary text-base cursor-pointer transition-colors duration-150"
        onClick={onNewSession}
        type="button"
        title="New session"
      >
        <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 500 }}>+</span>
      </button>
    </div>
  );
}

// ============================================================================
// SessionTabBar — merged component that switches between Classic and Unified
// ============================================================================

export const SessionTabBar = React.memo(function SessionTabBar({
  tabs,
  activeSessionKey,
  connectedAgents,
  overviewItems,
  onTabClick,
  onTabClose,
  onTabReorder,
  onNewSession,
  onRenameSession,
  pinnedSessionKeys = [],
  onTogglePin,
  layoutMode,
  splitDirection = "horizontal",
  onLayoutChange,
  onSplitDirectionChange,
}: SessionTabBarProps): React.ReactElement {
  // Render Unified mode when layoutMode is "split" or "grid"
  const isUnifiedMode = layoutMode === "split" || layoutMode === "grid";

  if (
    isUnifiedMode &&
    onTogglePin &&
    onLayoutChange &&
    onSplitDirectionChange
  ) {
    return (
      <UnifiedTabBar
        tabs={tabs}
        activeSessionKey={activeSessionKey}
        pinnedSessionKeys={pinnedSessionKeys}
        connectedAgents={connectedAgents}
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onTogglePin={onTogglePin}
        onNewSession={onNewSession}
        layoutMode={layoutMode}
        splitDirection={splitDirection}
        onLayoutChange={onLayoutChange}
        onSplitDirectionChange={onSplitDirectionChange}
      />
    );
  }

  // Default: Classic mode
  return (
    <ClassicTabBar
      tabs={tabs}
      activeSessionKey={activeSessionKey}
      connectedAgents={connectedAgents}
      overviewItems={overviewItems}
      onTabClick={onTabClick}
      onTabClose={onTabClose}
      onTabReorder={onTabReorder}
      onNewSession={onNewSession}
      onRenameSession={onRenameSession}
    />
  );
});
