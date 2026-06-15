// ============================================================================
// Mappers — convert extension-side types to webview DTOs
// ============================================================================

import type { SessionInfo } from "../../types";
import type { SessionInfoDTO, SessionState, TurnOutcome } from "./sessionStore";

export type { SessionInfo, SessionInfoDTO };

/**
 * Convert a SessionInfo (from extension host) to a SessionInfoDTO.
 * `messages` is intentionally dropped — the webview manages messages
 * via messageStore and derives counts from there.
 */
export function toSessionInfoDTO(info: SessionInfo): SessionInfoDTO {
  return {
    sessionId: info.sessionId,
    agentId: info.agentId,
    status: info.status as SessionState,
    lastTurnOutcome: info.lastTurnOutcome as TurnOutcome | null,
    isStreaming: info.isStreaming,
    tokenUsage: {
      inputTokens: info.tokenUsage.input,
      outputTokens: info.tokenUsage.output,
      totalTokens: info.tokenUsage.total,
    },
    contextWindowMax: info.contextWindowMax,
    model: info.model,
    mode: info.mode,
    cwd: info.cwd,
    createdAt: info.createdAt,
    lastResponseAt: info.lastResponseAt,
  };
}
