import React from "react";
import { ChatContainer } from "../ChatContainer";
import type { ChatContainerProps } from "../ChatContainer";
import type { ChatMessage } from "../../types";

export interface SectionChatContainerProps {
  sessionKey: string;
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
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
  messages,
  isStreaming,
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
        messages={messages}
        isStreaming={isStreaming}
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
