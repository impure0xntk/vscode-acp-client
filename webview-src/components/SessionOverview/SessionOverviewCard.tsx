import React from "react";
import type { SessionOverviewItem } from "../../types";
import { Icon } from "../../lib/icons";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  SessionOverviewFooter,
  ResponsePreviewList,
} from "./SessionOverviewCardBase";

interface Props {
  session: SessionOverviewItem;
  isExpanded: boolean;
  unreadCount: number;
  isActive: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCancel: () => void;
}

export function SessionOverviewCard({
  session,
  isExpanded,
  unreadCount,
  isActive,
  onToggle,
  onFocus,
  onCancel,
}: Props): React.ReactElement {
  const isCancelable =
    session.status === "running" || session.status === "waiting";

  return (
    <div
      className={`session-overview-card${isExpanded ? " session-overview-card-expanded" : ""}${isActive ? " session-overview-card-active" : ""}`}
      data-status={session.status}
      onClick={onFocus}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onFocus();
      }}
    >
      {/* Header: spinner + agent + title — badge overlaid top-right */}
      <div style={{ position: "relative" }}>
        <SessionOverviewHeader session={session} />
        {unreadCount > 0 && (
          <span className="session-overview-card-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>

      {/* Chips row — shared */}
      <SessionOverviewChips session={session} />

      {/* Response preview — always visible, more when expanded */}
      <ResponsePreviewList
        responses={session.recentResponses}
        maxItems={isExpanded ? 5 : 3}
      />

      {/* Footer: timestamp + action buttons */}
      <div className="session-overview-card-footer">
        <span className="session-overview-card-timestamp">
          {new Date(session.updatedAt).toLocaleTimeString()}
        </span>
        <div className="session-overview-card-actions">
          {isCancelable && (
            <button
              className="session-overview-card-cancel"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              title="Cancel session"
            >
              <Icon name="close" size="sm" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
