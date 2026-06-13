import React, { useState, useMemo } from "react";
import type { ToolCallCardProps } from "./index";
import { ToolCallCard, getFileExtension, fileIcon } from "./index";
import { GroupedToolCallCard } from "./GroupedToolCallCard";
import { StatusIcon } from "../StatusIcon";
import { summarizeKinds } from "../../util/toolBatchSummary";
import { Icon } from "../../lib/icons";
import { getVsCodeApi } from "../../lib/vscodeApi";

// ── Aggregation helpers ───────────────────────────────────────────────────

type SummaryStatus = "in_progress" | "completed" | "failed" | "cancelled" | "warning";

function aggregateStatuses(calls: ToolCallCardProps[]): SummaryStatus {
  const statuses = calls.map((c) => c.status);
  if (statuses.some((s) => s === "in_progress")) return "in_progress";
  if (statuses.some((s) => s === "failed")) {
    return statuses.every((s) => s === "failed") ? "failed" : "warning";
  }
  if (statuses.some((s) => s === "cancelled")) return "cancelled";
  return "completed";
}

function collectUniqueLocations(calls: ToolCallCardProps[]): Array<{ path: string; line?: number }> {
  const seen = new Set<string>();
  const result: Array<{ path: string; line?: number }> = [];
  for (const call of calls) {
    for (const loc of call.locations ?? []) {
      const key = `${loc.path}:${loc.line ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(loc);
      }
    }
  }
  return result;
}

function countKinds(calls: ToolCallCardProps[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) {
    const k = call.kind ?? "tool_call";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function uniqueKinds(calls: ToolCallCardProps[]): string[] {
  return [...new Set(calls.map((c) => c.kind ?? "tool_call"))];
}

function callsOfKind(calls: ToolCallCardProps[], kind: string): ToolCallCardProps[] {
  return calls.filter((c) => (c.kind ?? "tool_call") === kind);
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface ToolBatchSummaryProps {
  calls: ToolCallCardProps[];
}

// ── Component ─────────────────────────────────────────────────────────────

export function ToolBatchSummary({
  calls,
}: ToolBatchSummaryProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const status = useMemo(() => aggregateStatuses(calls), [calls]);
  const locations = useMemo(() => collectUniqueLocations(calls), [calls]);
  const kindSummary = useMemo(() => summarizeKinds(countKinds(calls)), [calls]);
  const kinds = useMemo(() => uniqueKinds(calls), [calls]);
  const isMultiKind = kinds.length > 1;

  const handleFileClick = (path: string, line?: number) => {
    try {
      getVsCodeApi().postMessage({ type: "openFile", path, line });
    } catch {
      /* vscodeApi not available */
    }
  };

  return (
    <div className={`tool-call tool-call-${status}`}>
      <button
        className="tool-call-header tool-call-header-clickable"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="tool-status-icon">
          <StatusIcon status={status} />
        </span>
        <span className="tool-batch-kinds">
          {kindSummary.map((item) => (
            <span key={item.kind} className="tool-batch-kind-entry">
              <Icon name={item.icon} size="sm" className="tool-batch-kind-icon" />
              <span className="tool-batch-kind-label">{item.label}</span>
              <span className="tool-batch-kind-count">×{item.count}</span>
            </span>
          ))}
        </span>
        {locations.map((loc, idx) => {
          const ext = getFileExtension(loc.path);
          const basename = loc.path.split("/").pop() ?? loc.path;
          return (
            <span
              key={`${loc.path}:${loc.line ?? 0}-${idx}`}
              className="file-chip file-chip-inline"
              onClick={(e) => {
                e.stopPropagation();
                handleFileClick(loc.path, loc.line);
              }}
              title={loc.line ? `${loc.path}:${loc.line}` : loc.path}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  handleFileClick(loc.path, loc.line);
                }
              }}
            >
              <span className="file-chip-ext">{fileIcon(ext)}</span>
              <span className="file-chip-label">
                {basename}
                {loc.line ? `:${loc.line}` : ""}
              </span>
            </span>
          );
        })}
        <span className={`tool-chevron ${expanded ? "open" : ""}`} aria-hidden="true">
          ▶
        </span>
      </button>

      {expanded && (
        <div className="tool-call-body">
          {isMultiKind ? (
            // Multi-kind: one GroupedToolCallCard per kind
            kinds.map((kind) => {
              const kindCalls = callsOfKind(calls, kind);
              return (
                <div key={kind} className="tool-batch-kind-group">
                  <GroupedToolCallCard
                    kind={kind}
                    count={kindCalls.length}
                    calls={kindCalls}
                  />
                </div>
              );
            })
          ) : (
            // Single-kind with < GROUP_THRESHOLD originally → show individual cards
            calls.map((call) => (
              <div key={call.id} className="tool-batch-item">
                <ToolCallCard {...call} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
