import React, { useEffect } from "react";
import { Icon } from "../lib/icons";
import type { TurnOutcome } from "./StatusIcon";

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

const OUTCOME_CLASS: Record<TurnOutcome, string> = {
  completed: "completion-notification--completed",
  error: "completion-notification--error",
  cancelled: "completion-notification--cancelled",
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
  const outcomeCls = OUTCOME_CLASS[outcome];

  return (
    <div
      className={`completion-notification ${outcomeCls}${isVisible ? " completion-notification-visible" : ""}${isLeaving ? " completion-notification-leaving" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
    >
      <div className="completion-notification-content">
        <Icon
          name={iconName}
          className="completion-notification-icon"
          size="sm"
        />
        <span className="completion-notification-text">
          <span className="completion-notification-title">{displayName}</span>
          <span className="completion-notification-agent">{agentId}</span>
        </span>
      </div>
      <button
        className="completion-notification-close"
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
