import { iconForToolKind } from "../lib/icons";

export interface KindSummaryItem {
  kind: string;
  icon: string;
  label: string;
  count: number;
  known: boolean;
}

const KNOWN_KINDS = new Set([
  "read",
  "write",
  "edit",
  "delete",
  "bash",
  "shell",
  "search",
  "grep",
  "list",
  "fetch",
  "web_search",
  "web_fetch",
  "apply_patch",
  "todo",
  "task",
  "mcp",
]);

const FALLBACK_KINDS = new Set([
  "tool_call",
  "tool",
  "multi_tool_use_parallel",
]);

/**
 * Return a structured summary of tool-kind counts.
 * Known kinds appear first (sorted by descending count),
 * then fallback/unknown kinds (also sorted by descending count).
 */
export function summarizeKinds(
  kindCounts: Record<string, number>,
): KindSummaryItem[] {
  const entries = Object.entries(kindCounts).map(([kind, count]) => {
    const k = kind.toLowerCase().trim();
    const known = KNOWN_KINDS.has(k);
    const icon = iconForToolKind(k);
    const label = FALLBACK_KINDS.has(k) ? "TOOL_CALL" : kind;
    return { kind, icon, label, count, known };
  });

  const known = entries.filter((e) => e.known).sort((a, b) => b.count - a.count);
  const fallback = entries
    .filter((e) => !e.known)
    .sort((a, b) => b.count - a.count);

  return [...known, ...fallback];
}
