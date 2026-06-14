import React from "react";
import type { SessionOverviewItem } from "../../types";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  ResponsePreviewList,
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
      <SessionOverviewHeader session={session} className="so-popup-header" />

      {/* Chips row — shared */}
      <SessionOverviewChips session={session} />

      {/* Recent responses — shared */}
      <ResponsePreviewList
        responses={session.recentResponses}
        maxItems={5}
        className="so-popup-previews"
      />

      {/* Footer: last-response timestamp */}
      <div className="so-popup-footer">
        <span className="so-popup-timestamp">
          {new Date(session.lastResponseAt ?? session.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
