import React, { useEffect } from "react";
import { useLogger } from "../../hooks/useLogger";
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
  agentId,
  sessionId,
  status,
  isActive,
  color,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
}: SectionChatContainerProps): React.ReactElement {
  const log = useLogger("SectionChatContainer");

  useEffect(() => {
    log.debug("mount", { sessionKey, sessionId, agentId });
    return () => {
      log.debug("unmount", { sessionKey });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, sessionId, agentId]);

  return (
    <ChatContainer
      sessionId={sessionId}
      sessionKey={sessionKey}
      status={status}
      isActive={isActive}
      scrollToMessageRef={scrollToMessageRef}
      forceScrollToBottomRef={forceScrollToBottomRef}
      scrollToUnreadRef={scrollToUnreadRef}
    />
  );
});
