import React from "react";
import { StatusIcon } from "./StatusIcon";

interface SessionTabProps {
  sessionId: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  isActive: boolean;
  unreadCount: number;
  agentId: string;
  agentColor?: string;
  agentIcon?: string;
  onClose: (sessionId: string) => void;
  onClick: (sessionId: string, agentId: string) => void;
  onDragStart?: (e: React.DragEvent, sessionId: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, sessionId: string) => void;
}

export function SessionTab({
  sessionId,
  title,
  status,
  isActive,
  unreadCount,
  agentId,
  agentColor,
  agentIcon,
  onClose,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
}: SessionTabProps): React.ReactElement {
  const handleClick = () => {
    onClick(sessionId, agentId);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(sessionId);
  };

  const handleDragStart = (e: React.DragEvent) => {
    onDragStart?.(e, sessionId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    onDragOver?.(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    onDrop?.(e, sessionId);
  };

  return (
    <div
      className={`session-tab ${isActive ? "session-tab-active" : ""}${isActive && (status === "running" || status === "working") ? " status-tab-has-running-status" : ""}`}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      draggable
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <StatusIcon status={status} />

      {agentIcon && (
        <span className="session-tab-agent-icon">{agentIcon}</span>
      )}

      <span className="session-tab-title" title={title}>
        {title}
      </span>

      {unreadCount > 0 && !isActive && (
        <span className="session-tab-badge">{unreadCount}</span>
      )}

      <button
        className="session-tab-close"
        type="button"
        aria-label="Close tab"
        onClick={handleClose}
      >
        ×
      </button>
    </div>
  );
}
