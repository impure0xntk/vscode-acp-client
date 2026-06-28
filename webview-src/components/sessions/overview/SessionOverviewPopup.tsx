import React from "react";
import type { SessionOverviewItem } from "../../../types";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  ResponsePreviewList,
  snapshotToOverviewItem,
} from "./SessionOverviewCardBase";

interface Props {
  session: SessionOverviewItem;
  anchorRect: DOMRect;
}

export function SessionOverviewPopup({
  session,
  anchorRect,
}: Props): React.ReactElement {
  const liveInfo = useSessionInfo(`${session.agentId}:${session.sessionId}`);
  const liveItem: SessionOverviewItem = liveInfo
    ? snapshotToOverviewItem(liveInfo, session.title)
    : session;

  const gap = 4;
  const popupWidth = 260;
  const left =
    anchorRect.right + popupWidth + gap < window.innerWidth
      ? anchorRect.right + gap
      : anchorRect.left - popupWidth - gap;
  const top = Math.min(anchorRect.top, window.innerHeight - 200);

  return (
    <div
      className="flex flex-col gap-1.5 p-[8px 10px] z-[1000] bg-bg-secondary border border-border rounded-lg animate-so-popup-in"
      style={{
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${popupWidth}px`,
      }}
    >
      <SessionOverviewHeader session={liveItem} />
      <SessionOverviewChips session={liveItem} />
      <ResponsePreviewList
        responses={liveItem.recentResponses}
        maxItems={5}
      />

      <div className="flex justify-end border-t border-border/40 pt-[4px] mt-[2px]">
        <span className="text-3xs text-fg-muted font-mono">
          {new Date(
            liveItem.lastResponseAt ?? liveItem.createdAt
          ).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
