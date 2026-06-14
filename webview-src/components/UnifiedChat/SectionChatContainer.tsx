import React from "react";
import { ChatContainer } from "../ChatContainer";

export interface SectionChatContainerProps {
  sessionKey: string;
  agentId: string;
  sessionId: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  isActive: boolean;
  color: string;
  scrollToMessageRef?: React.MutableRefObject<((id: string) => void) | undefined>;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
}

export const SectionChatContainer = React.memo(function SectionChatContainer({
  sessionKey,
  sessionId,
  status,
  isActive,
  color,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
}: SectionChatContainerProps): React.ReactElement {
  return (
    <div
      className="unified-session-section"
      data-color-group={color}
    >
      <ChatContainer
        sessionId={sessionId}
        sessionKey={sessionKey}
        status={status}
        isActive={isActive}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
      />
    </div>
  );
});
