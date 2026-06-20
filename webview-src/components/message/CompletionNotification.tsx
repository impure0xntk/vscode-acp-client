import React, { useEffect } from "react";
import { Icon } from "../../lib/icons";
import type { TurnOutcome } from "../primitives/StatusIcon";

// ============================================================================
// Props
// ============================================================================

interface CompletionNotificationProps {
  agentId: string;
  sessionId: string;
  title: string;
  /** Turn outcome — determines the icon and styling */
  outcome?: TurnOutcome;
  onDismiss: () => void;
  onSwitchTab: (sessionId: string, agentId: string) => void;
}

// ============================================================================
// CompletionNotification Component
// ============================================================================

const OUTCOME_ICON: Record<TurnOutcome, string> = {
  completed: "pass-filled",
  error: "error",
  cancelled: "circle-slash",
};

const OUTCOME_BORDER: Record<TurnOutcome, string> = {
  completed: "border-[var(--success)]",
  error: "border-[var(--error)]",
  cancelled: "border-[var(--fg-muted)]",
};

export function CompletionNotification({
  agentId,
  sessionId,
  title,
  outcome = "completed",
  onDismiss,
  onSwitchTab,
}: CompletionNotificationProps): React.ReactElement {
  const [isVisible, setIsVisible] = React.useState(false);
  const [isLeaving, setIsLeaving] = React.useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleDismiss = React.useCallback(() => {
    setIsLeaving(true);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  const handleClick = React.useCallback(() => {
    onSwitchTab(sessionId, agentId);
    handleDismiss();
  }, [onSwitchTab, sessionId, agentId, handleDismiss]);

  const displayName = title || sessionId.slice(0, 8);
  const iconName = OUTCOME_ICON[outcome];
  const borderCls = OUTCOME_BORDER[outcome];

  return (
    <div
      className={`completion-notification relative flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border ${borderCls} rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.3)] cursor-pointer max-w-[280px] pointer-events-auto transition-transform duration-300 hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1${isVisible ? " translate-x-0" : " translate-x-[120%]"}${isLeaving ? " translate-x-[120%]" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon
          name={iconName}
          className="flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[var(--success)] text-[var(--bg-primary)] text-[11px] font-bold"
          size="sm"
        />
        <span className="flex flex-col gap-px flex-1 min-w-0 overflow-hidden">
          <span className="text-xs font-medium text-[var(--fg-primary)] whitespace-nowrap overflow-hidden text-ellipsis">
            {displayName}
          </span>
          <span className="text-[10px] text-[var(--fg-muted)]">
            {agentId}
          </span>
        </span>
      </div>
      <button
        className="flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-transparent text-[var(--fg-secondary)] text-xs leading-none cursor-pointer transition-colors duration-150 hover:bg-[var(--error)] hover:text-[var(--user-fg)]"
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        aria-label="Dismiss"
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}
