// ============================================================================
// Mappers — convert extension-side types to webview DTOs
// ============================================================================

import type { SessionInfoDTO, SessionState, TurnOutcome } from "./sessionStore";

/**
 * Extension-host-side session info (pre-DTO).
 * This is a loose type for the raw JSON payload from the extension host.
 * Field types are wider than domain/SessionInfo (e.g. status: string vs
 * SessionStatus) because the data crosses a serialization boundary.
 */
export interface ExtensionSessionInfo {
  sessionId: string;
  agentId: string;
  status: string;
  lastTurnOutcome: string | null;
  isStreaming: boolean;
  tokenUsage: { input: number; output: number; total: number };
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  createdAt: string;
  lastResponseAt: string | null;
}

/**
 * Convert a SessionInfo (from extension host) to a SessionInfoDTO.
 * `messages` is intentionally dropped — the webview manages messages
 * via messageStore and derives counts from there.
 */
export function toSessionInfoDTO(info: ExtensionSessionInfo): SessionInfoDTO {
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
