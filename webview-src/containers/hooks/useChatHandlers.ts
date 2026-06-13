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
    (text: string, attachments: ContextAttachment[], agentId?: string, sessionId?: string) => {
      // If agentId/sessionId are provided (from @mention), use them; otherwise fall back to active
      const resolvedAgentId = agentId ?? activeAgentId ?? undefined;
      const resolvedSessionId = sessionId ?? activeSessionId ?? undefined;
      sendMessage(text, attachments, resolvedAgentId, resolvedSessionId);
      forceScrollToBottomRef.current?.();
    },
    [sendMessage, activeAgentId, activeSessionId, forceScrollToBottomRef],
  );

  const handleCancel = useCallback(() => {
    cancelTurn(activeAgentId ?? undefined, activeSessionId ?? undefined);
  }, [cancelTurn, activeAgentId, activeSessionId]);

  return useMemo(() => ({ handleSend, handleCancel }), [handleSend, handleCancel]);
}
