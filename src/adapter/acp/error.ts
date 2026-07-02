import { RequestError } from "@agentclientprotocol/sdk";

// ---------------------------------------------------------------------------
// Structured ACP error types
//
// Adapted from kilo's error.ts for client-side use.
// These errors wrap ACP protocol errors with structured metadata
// for logging, telemetry, and user-facing messages.
// ---------------------------------------------------------------------------

/** Unique tag for discriminating ACP error types at runtime. */
export type AcpErrorTag =
  | "ACP.SessionNotFound"
  | "ACP.ConnectionFailed"
  | "ACP.InitializeFailed"
  | "ACP.PermissionDenied"
  | "ACP.ToolExecutionFailed";

/** Structured ACP error interface. */
export interface AcpError {
  readonly _tag: AcpErrorTag;
  readonly message: string;
  readonly cause?: unknown;
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function sessionNotFound(
  sessionId: string,
  cause?: unknown
): AcpError {
  return {
    _tag: "ACP.SessionNotFound",
    message: `Session not found: ${sessionId}`,
    cause,
    metadata: { sessionId },
  };
}

export function connectionFailed(
  agentId: string,
  cause?: unknown
): AcpError {
  return {
    _tag: "ACP.ConnectionFailed",
    message: `Failed to connect to agent: ${agentId}`,
    cause,
    metadata: { agentId },
  };
}

export function initializeFailed(
  agentId: string,
  reason?: string
): AcpError {
  return {
    _tag: "ACP.InitializeFailed",
    message: reason
      ? `Agent ${agentId} initialization failed: ${reason}`
      : `Agent ${agentId} initialization failed`,
    cause: undefined,
    metadata: { agentId, reason },
  };
}

export function permissionDenied(
  agentId: string,
  toolCallId: string,
  toolName: string
): AcpError {
  return {
    _tag: "ACP.PermissionDenied",
    message: `Permission denied for tool "${toolName}" (${toolCallId}) on agent ${agentId}`,
    cause: undefined,
    metadata: { agentId, toolCallId, toolName },
  };
}

export function toolExecutionFailed(
  toolCallId: string,
  toolName: string,
  cause?: unknown
): AcpError {
  return {
    _tag: "ACP.ToolExecutionFailed",
    message: `Tool "${toolName}" execution failed: ${toolCallId}`,
    cause,
    metadata: { toolCallId, toolName },
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Check if a value is a structured AcpError. */
export function isAcpError(value: unknown): value is AcpError {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    typeof (value as AcpError)._tag === "string" &&
    (value as AcpError)._tag.startsWith("ACP.")
  );
}

// ---------------------------------------------------------------------------
// ACP RequestError conversion
// ---------------------------------------------------------------------------

/**
 * Convert a structured AcpError to an ACP RequestError.
 *
 * RequestError is the standard error type thrown by the ACP SDK.
 * This function maps our internal error tags to the appropriate
 * RequestError subclasses.
 */
export function toRequestError(error: AcpError): RequestError {
  switch (error._tag) {
    case "ACP.SessionNotFound":
      return RequestError.internalError(
        undefined,
        error.message
      );
    case "ACP.ConnectionFailed":
      return RequestError.internalError(
        undefined,
        error.message
      );
    case "ACP.InitializeFailed":
      return RequestError.internalError(
        undefined,
        error.message
      );
    case "ACP.PermissionDenied":
      return RequestError.internalError(
        undefined,
        error.message
      );
    case "ACP.ToolExecutionFailed":
      return RequestError.internalError(
        undefined,
        error.message
      );
    default:
      return RequestError.internalError(
        undefined,
        error.message
      );
  }
}
