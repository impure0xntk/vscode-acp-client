import { iconForToolKind } from "./icons";

export interface KindSummaryItem {
  kind: string;
  icon: string;
  abbr: string;
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
  "tool_call",
]);

/** Single-character abbreviation for known tool kinds */
const KIND_ABBR: Record<string, string> = {
  read: "R",
  write: "W",
  edit: "E",
  delete: "D",
  bash: "B",
  shell: "B",
  search: "S",
  grep: "G",
  list: "L",
  fetch: "F",
  web_search: "S",
  web_fetch: "F",
  apply_patch: "P",
  todo: "T",
  task: "K",
  mcp: "M",
  tool_call: "T",
};

/** Abbreviation for summary display (1-2 chars) */
export function kindAbbr(kind: string | undefined): string {
  const k = (kind ?? "").toLowerCase().trim();
  if (!k) return "T";
  return KIND_ABBR[k] ?? k.charAt(0).toUpperCase();
}

/**
 * Return a structured summary of tool-kind counts.
 * Known kinds appear first (sorted by descending count),
 * then fallback/unknown kinds (also sorted by descending count).
 * Uses single-character abbreviations for compact display.
 */
export function summarizeKinds(
  kindCounts: Record<string, number>
): KindSummaryItem[] {
  const entries = Object.entries(kindCounts).map(([kind, count]) => {
    const k = kind.toLowerCase().trim();
    const known = KNOWN_KINDS.has(k);
    const icon = iconForToolKind(k);
    const abbr = kindAbbr(k);
    return { kind, icon, abbr, count, known };
  });

  const known = entries
    .filter((e) => e.known)
    .sort((a, b) => b.count - a.count);
  const fallback = entries
    .filter((e) => !e.known)
    .sort((a, b) => b.count - a.count);

  return [...known, ...fallback];
}
