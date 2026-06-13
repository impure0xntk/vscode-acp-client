export interface MessageContent {
  type: "text";
  text: string;
}
export interface ToolCallLocation {
  path: string;
  line?: number;
}
export interface ToolCallDiffContent {
  type: "diff";
  diff: string;
  oldPath?: string;
  newPath?: string;
}
export interface ToolCall {
  id: string;
  title: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  kind: string;
  content?: MessageContent[];
  input?: Record<string, unknown> | string;
  output?: string;
  durationMs?: number;
  locations?: ToolCallLocation[];
  diffContent?: ToolCallDiffContent;
}
export interface ThinkingContent {
  type: "thinking";
  content: string;
  isStreaming?: boolean;
}
export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: ThinkingContent;
  /** Session cwd — used to resolve relative file paths in inline code references */
  sessionCwd?: string;
  /** File paths confirmed to exist — inline code matching these becomes clickable links */
  inlineFilePaths?: string[];
}
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface ContextAttachment {
  id: string;
  type: "file" | "selection" | "symbol" | "diff";
  path: string;
  label: string;
  lineRange?: [number, number];
  tokenCount: number;
  content: string;
}
/**
 * Trigger characters that open the suggestion panel.
 * # is the primary trigger; queries are disambiguated by prefix:
 *   #file.py or just # → file search
 *   #symbol → symbol search
 */
export type TriggerType = "/" | "#";
/** A file candidate returned by the extension host */
export interface FileCandidate {
  relativePath: string;
  name: string;
  absolutePath?: string;
}
/**
 * Unified suggestion item for the autocomplete panel.
 * Query format per trigger:
 *   /   → "command"
 *   #   → "file" | "selection" | "diff" (when query is empty or starts with non-"symbol" prefix)
 *   #symbol → "symbol"
 */
export interface SuggestionItem {
  id: string;
  kind: "file" | "selection" | "diff" | "command" | "symbol";
  label: string;
  /** Relative path for files, command id for commands, symbol name for symbols */
  value: string;
  /** Optional detail line (e.g. file path tail, symbol type, command description) */
  detail?: string;
  /** Icon hint for the renderer */
  icon?: string;
}
export interface StreamChunk {
  type: "streamChunk";
  chunk: string;
}
export interface FullState {
  type: "fullState";
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
  isTurnActive: boolean;
}
export interface ToolCallInfo {
  id: string;
  title: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  kind: string;
  durationMs?: number;
}

// ============================================================================
// Session Overview Panel types
// ============================================================================

/** セッション俯瞰パネルの状態 */
export interface SessionOverviewState {
  sessions: SessionOverviewItem[];
  lastUpdated: string;
  filter: SessionOverviewFilter;
  expandedSessions: string[];
}

export type SessionOverviewFilter = "all" | "active" | "by-agent";

/** 1セッション分の概要 */
export interface SessionOverviewItem {
  sessionId: string;
  agentId: string;
  title: string;
  status: "idle" | "running" | "waiting" | "completed" | "error" | "cancelled";
  model?: string;
  mode?: string;
  progress: SessionProgress;
  recentResponses: ResponsePreview[];
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}

/** 進捗指標 */
export interface SessionProgress {
  elapsedMs: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  contextWindow?: {
    used: number;
    max: number;
    percentage: number;
  };
  messageCount: number;
  toolCallCount: number;
  toolCallsCompleted: number;
}

/** 応答プレビュー */
export interface ResponsePreview {
  messageId: string;
  role: "agent" | "tool";
  preview: string;
  toolName?: string;
  status?: "completed" | "running" | "failed";
  timestamp: string;
}

/** Webview メッセージ (Session Overview 関連) */
export type SessionOverviewWebviewMessage =
  | { type: "sessionOverview:state"; payload: SessionOverviewState }
  | { type: "sessionOverview:update"; payload: SessionOverviewItem }
  | { type: "sessionOverview:toggle"; payload: { visible: boolean } }
  | { type: "sessionOverview:expand"; payload: { sessionId: string } }
  | { type: "sessionOverview:collapse"; payload: { sessionId: string } }
  | {
      type: "sessionOverview:focus";
      payload: { sessionId: string; agentId: string };
    }
  | {
      type: "sessionOverview:cancel";
      payload: { sessionId: string; agentId: string };
    };
//# sourceMappingURL=types.d.ts.map
