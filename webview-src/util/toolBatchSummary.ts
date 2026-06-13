import type { ToolCall } from "../types";
import { iconForToolKind } from "../lib/icons";

/** Kind abbreviation mapping for the summary line */
const KIND_ABBREV: Record<string, string> = {
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
  web_search: "WS",
  web_fetch: "WF",
  apply_patch: "AP",
  todo: "T",
  task: "TK",
  mcp: "M",
};

export interface BatchSummary {
  totalCount: number;
  uniqueFiles: string[];
  kindCounts: Record<string, number>;
  totalDurationMs: number;
  hasErrors: boolean;
  dominantKind: string;
}

/**
 * Extract a file path from a tool call's locations or input.
 */
function extractFilePath(call: ToolCall): string | null {
  if (call.locations && call.locations.length > 0) {
    return call.locations[0].path;
  }
  if (call.input && typeof call.input === "object") {
    const candidates = [
      (call.input as Record<string, unknown>).file_path,
      (call.input as Record<string, unknown>).path,
      (call.input as Record<string, unknown>).filePath,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
  }
  return null;
}

/**
 * Compute an aggregate summary from a batch of tool calls.
 */
export function computeBatchSummary(calls: ToolCall[]): BatchSummary {
  const kindCounts: Record<string, number> = {};
  const seenFiles = new Set<string>();
  const uniqueFiles: string[] = [];
  let totalDurationMs = 0;
  let hasErrors = false;

  for (const call of calls) {
    const kind = (call.kind ?? "tool_call").trim();
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;

    const filePath = extractFilePath(call);
    if (filePath && !seenFiles.has(filePath)) {
      seenFiles.add(filePath);
      uniqueFiles.push(filePath);
    }

    if (call.durationMs !== undefined) {
      totalDurationMs += call.durationMs;
    }

    if (call.status === "failed" || call.status === "cancelled") {
      hasErrors = true;
    }
  }

  // Dominant kind = most frequent; tie-break by first occurrence
  let dominantKind = "tool_call";
  let maxCount = 0;
  for (const [kind, count] of Object.entries(kindCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantKind = kind;
    }
  }

  return {
    totalCount: calls.length,
    uniqueFiles,
    kindCounts,
    totalDurationMs,
    hasErrors,
    dominantKind,
  };
}

/**
 * Return the SVG icon name for a given kind.
 */
export function kindIconName(kind: string): string {
  return iconForToolKind(kind);
}

/**
 * Return the abbreviation for a given kind.
 */
export function kindAbbrev(kind: string): string {
  const k = kind.toLowerCase().trim();
  return KIND_ABBREV[k] ?? kind.charAt(0).toUpperCase();
}

/**
 * Format kind counts as a compact string: `{ read: 3, write: 2 }` → `"3R 2W"`.
 */
export function formatKindCounts(kindCounts: Record<string, number>): string {
  return Object.entries(kindCounts)
    .map(([kind, count]) => `${count}${kindAbbrev(kind)}`)
    .join(" ");
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDurationMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * Truncate a file path for display: keep basename + parent dir if needed.
 */
export function truncateFilePath(path: string, maxLen: number = 30): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  const basename = parts[parts.length - 1] ?? path;
  if (basename.length >= maxLen - 3) return `…/${basename.slice(-maxLen + 2)}`;
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  const short = parent ? `${parent}/${basename}` : basename;
  if (short.length <= maxLen) return short;
  return `…/${basename}`;
}
