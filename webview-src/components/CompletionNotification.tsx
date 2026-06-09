import React, { useEffect } from "react";

// ============================================================================
// Props
// ============================================================================

interface CompletionNotificationProps {
  agentId: string;
  sessionId: string;
  title: string;
  onDismiss: () => void;
  onSwitchTab: (sessionId: string, agentId: string) => void;
}

// ============================================================================
// CompletionNotification Component
// ============================================================================

export function CompletionNotification({
  agentId,
  sessionId,
  title,
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

  return (
    <div
      className={`completion-notification${isVisible ? " completion-notification-visible" : ""}${isLeaving ? " completion-notification-leaving" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
    >
      <div className="completion-notification-content">
        <span className="completion-notification-icon">✓</span>
        <span className="completion-notification-text">
          <span className="completion-notification-title">{displayName}</span>
          <span className="completion-notification-agent">{agentId}</span>
        </span>
      </div>
      <button
        className="completion-notification-close"
        onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
