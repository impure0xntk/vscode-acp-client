import React from "react";
import type { SessionOverviewItem } from "../../../types";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  ResponsePreviewList,
  snapshotToOverviewItem,
} from "./SessionOverviewCardBase";

// ============================================================================
// Props
// ============================================================================

interface Props {
  session: SessionOverviewItem;
  anchorRect: DOMRect;
}

// ============================================================================
// Popup Component
// ============================================================================

export function SessionOverviewPopup({
  session,
  anchorRect,
}: Props): React.ReactElement {
  // Subscribe to live session info so the popup reflects current status/tokens.
  const liveInfo = useSessionInfo(`${session.agentId}:${session.sessionId}`);
  const liveItem: SessionOverviewItem = liveInfo
    ? snapshotToOverviewItem(liveInfo, session.title)
    : session;

  // Position: show to the right of the tab, or flip left if too close to edge
  const gap = 4;
  const popupWidth = 260;
  const left =
    anchorRect.right + popupWidth + gap < window.innerWidth
      ? anchorRect.right + gap
      : anchorRect.left - popupWidth - gap;
  const top = Math.min(anchorRect.top, window.innerHeight - 200);

  return (
    <div
      className="so-popup"
      style={{
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${popupWidth}px`,
      }}
    >
      {/* Header: spinner + agent + title — shared */}
      <SessionOverviewHeader session={liveItem} className="so-popup-header" />

      {/* Chips row — shared */}
      <SessionOverviewChips session={liveItem} />

      {/* Recent responses — shared */}
      <ResponsePreviewList
        responses={liveItem.recentResponses}
        maxItems={5}
        className="so-popup-previews"
      />

      {/* Footer: last-response timestamp */}
      <div className="so-popup-footer">
        <span className="so-popup-timestamp">
          {new Date(
            liveItem.lastResponseAt ?? liveItem.createdAt
          ).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
