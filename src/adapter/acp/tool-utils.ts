import type { ToolKind } from "@agentclientprotocol/sdk";

// ---------------------------------------------------------------------------
// Tool name → ToolKind mapping
//
// Adapted from cline (apps/cli/src/acp/tool-utils.ts) and
// kilo (packages/opencode/src/acp/tool.ts) for client-side display.
// ---------------------------------------------------------------------------

const TOOL_KIND_MAP: Record<string, ToolKind> = {
  // Read operations
  Read: "read",
  read_files: "read",
  read: "read",

  // Search operations
  Glob: "search",
  Grep: "search",
  grep: "search",
  glob: "search",
  search_codebase: "search",
  repo_clone: "search",
  repo_overview: "search",
  context: "search",
  context7_resolve_library_id: "search",
  context7_get_library_docs: "search",

  // Edit operations
  Edit: "edit",
  Write: "edit",
  write: "edit",
  edit: "edit",
  patch: "edit",
  editor: "edit",
  NotebookEdit: "edit",

  // Delete operations
  Delete: "delete",

  // Move operations
  Move: "move",

  // Execute operations
  Bash: "execute",
  bash: "execute",
  shell: "execute",
  run_commands: "execute",

  // Fetch operations
  WebFetch: "fetch",
  fetch_web_content: "fetch",
  webfetch: "fetch",

  // Search (duplicate for web search variants)
  WebSearch: "search",

  // Think/plan operations
  Agent: "think",
  spawn_agent: "think",

  // Other
  skills: "other",
};

/**
 * Map a tool name to its ACP ToolKind for UI display and filtering.
 * Returns "other" when the tool name is not recognized.
 */
export function mapToolKind(toolName: string): ToolKind {
  return TOOL_KIND_MAP[toolName] ?? "other";
}

/**
 * Build a human-readable title for a tool call.
 *
 * Extracts a short summary from the tool input (file path, command, etc.)
 * and prefixes it with the tool name.  Falls back to the raw tool name
 * when no summary can be derived.
 */
export function buildToolTitle(toolName: string, input: unknown): string {
  const summary = formatToolInput(toolName, input);
  if (!summary) return toolName;
  return `${toolName}: ${summary}`;
}

// ---------------------------------------------------------------------------
// Input formatting helpers
// ---------------------------------------------------------------------------

function formatToolInput(toolName: string, input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  // File operations → show the path
  const filePath = stringValue(obj.filePath ?? obj.filepath ?? obj.path);
  if (filePath) return filePath;

  // Shell → show the command (truncated)
  const command = stringValue(obj.command);
  if (command) {
    const truncated =
      command.length > 60 ? command.slice(0, 60) + "…" : command;
    return truncated;
  }

  // Search → show the pattern
  const pattern = stringValue(obj.pattern ?? obj.query);
  if (pattern) return pattern;

  return "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
