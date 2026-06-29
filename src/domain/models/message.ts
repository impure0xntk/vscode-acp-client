// ============================================================================
// Message — structured representation of a conversation message
// ============================================================================

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type MessageContent =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      toolUseId: string;
      toolName: string;
      toolInput: unknown;
    }
  | { type: "tool_result"; toolUseId: string; toolResult: unknown }
  | { type: "image"; data: string; mimeType: string };

export interface MessageMetadata {
  agentId?: string;
  duration?: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface Message {
  /** ACP SDK messageId (agent msg) or sessionId-timestamp (user msg). */
  id: string;
  sessionId: string;
  role: MessageRole;
  content: MessageContent[];
  timestamp: Date;
  metadata?: MessageMetadata;
}
