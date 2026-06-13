import { useCallback, useMemo } from "react";
import type { ContextAttachment } from "../../types";

interface ChatHandlerDeps {
  activeAgentId: string | null;
  activeSessionId: string | null;
  sendMessage: (
    text: string,
    attachments?: ContextAttachment[],
    agentId?: string,
    sessionId?: string,
  ) => void;
  cancelTurn: (agentId?: string, sessionId?: string) => void;
  forceScrollToBottomRef: React.MutableRefObject<(() => void) | undefined>;
}

export function useChatHandlers(deps: ChatHandlerDeps) {
  const { activeAgentId, activeSessionId, sendMessage, cancelTurn, forceScrollToBottomRef } = deps;

  const handleSend = useCallback(
    (text: string, attachments: ContextAttachment[]) => {
      sendMessage(text, attachments, activeAgentId ?? undefined, activeSessionId ?? undefined);
      forceScrollToBottomRef.current?.();
    },
    [sendMessage, activeAgentId, activeSessionId, forceScrollToBottomRef],
  );

  const handleCancel = useCallback(() => {
    cancelTurn(activeAgentId ?? undefined, activeSessionId ?? undefined);
  }, [cancelTurn, activeAgentId, activeSessionId]);

  return useMemo(() => ({ handleSend, handleCancel }), [handleSend, handleCancel]);
}
