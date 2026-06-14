import React, { useState, useMemo } from "react";
import type { ToolCallCardProps } from "./index";
import { ToolCallCard, getFileExtension, fileIcon, formatDuration } from "./index";
import { StatusIcon } from "../StatusIcon";
import { summarizeKinds } from "../../util/toolBatchSummary";
import { Icon } from "../../lib/icons";
import { getVsCodeApi } from "../../lib/vscodeApi";

type InlineStatus = "completed" | "failed" | "warning";

function aggregateInlineStatus(calls: ToolCallCardProps[]): InlineStatus {
  const hasFailed = calls.some((c) => c.status === "failed");
  const hasWarning = calls.some((c) => c.status === "cancelled");
  if (hasFailed) return "failed";
  if (hasWarning) return "warning";
  return "completed";
}

function countKinds(calls: ToolCallCardProps[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) {
    const k = call.kind ?? "tool_call";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function totalDuration(calls: ToolCallCardProps[]): number {
  return calls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
}

function partitionErrors(calls: ToolCallCardProps[]): { errors: ToolCallCardProps[]; ok: ToolCallCardProps[] } {
  const errors: ToolCallCardProps[] = [];
  const ok: ToolCallCardProps[] = [];
  for (const call of calls) {
    if (call.status === "failed") {
      errors.push(call);
    } else {
      ok.push(call);
    }
  }
  return { errors, ok };
}

function collectUniqueLocations(calls: ToolCallCardProps[]): Array<{ path: string; line?: number }> {
  const seen = new Set<string>();
  const result: Array<{ path: string; line?: number }> = [];
  for (const call of calls) {
    for (const loc of call.locations ?? []) {
      const key = `${loc.path}:${loc.line ?? 0}`;
      if (!seen.has(key)) { seen.add(key); result.push(loc); }
    }
  }
  return result;
}

export interface ToolInlineSummaryProps {
  calls: ToolCallCardProps[];
}

/**
 * Inline tool summary rendered at the end of an agent message.
 * - Single call: file chip + duration + chevron
 * - Multi call: ops count + kind icons + duration + chevron
 * - Default: collapsed. Click to expand.
 * - If errors mixed in: expand errors only, OK items collapsed
 * - If all OK: show all cards expanded
 */
export function ToolInlineSummary({ calls }: ToolInlineSummaryProps): React.ReactElement {
  const status = useMemo(() => aggregateInlineStatus(calls), [calls]);
  const kindSummary = useMemo(() => summarizeKinds(countKinds(calls)), [calls]);
  const totalMs = useMemo(() => totalDuration(calls), [calls]);
  const locations = useMemo(() => collectUniqueLocations(calls), [calls]);
  const { errors, ok } = useMemo(() => partitionErrors(calls), [calls]);
  const hasErrors = errors.length > 0;
  const isSingle = calls.length === 1;

  // Default: collapsed. Auto-expand only when errors exist.
  const [expanded, setExpanded] = useState(hasErrors);

  const handleFileClick = (path: string, line?: number) => {
    try { getVsCodeApi().postMessage({ type: "openFile", path, line }); }
    catch { /* */ }
  };

  // ── Single call: compact inline ──
  if (isSingle) {
    const call = calls[0]!;
    const loc = call.locations?.[0];
    const basename = loc?.path.split("/").pop() ?? loc?.path;
    const ext = loc ? getFileExtension(loc.path) : "";

    return (
      <span className={`tool-inline tool-inline-${status}`}>
        <button
          className="tool-inline-summary"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className={`tool-inline-status-${status === "failed" ? "failed" : "ok"}`}>
            {status === "failed" ? (
              <Icon name="close" size="sm" />
            ) : (
              <Icon name="check" size="sm" />
            )}
          </span>
          {basename && (
            <span className="tool-inline-file">
              <span className="file-chip-ext">{fileIcon(ext)}</span>
              <span className="file-chip-label">{basename}{loc?.line ? `:${loc.line}` : ""}</span>
            </span>
          )}
          <span className="tool-inline-duration">{formatDuration(call.durationMs ?? 0)}</span>
          <span className={`tool-chevron ${expanded ? "open" : ""}`} aria-hidden="true">▶</span>
        </button>
        {expanded && (
          <div className="tool-inline-expanded">
            <ToolCallCard {...call} />
          </div>
        )}
      </span>
    );
  }

  // ── Multi call: ops + kinds + duration ──
  const prefixText = hasErrors
    ? "ツールを実行したが失敗しました。"
    : "ツールを実行しました。";

  return (
    <span className={`tool-inline tool-inline-${status}`}>
      <span className="tool-inline-prefix">{prefixText}</span>
      <button
        className="tool-inline-summary"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={`tool-inline-status-${status === "failed" ? "failed" : "ok"}`}>
          {status === "failed" ? (
            <Icon name="close" size="sm" />
          ) : (
            <Icon name="check" size="sm" />
          )}
        </span>
        <span className="tool-inline-ops">{calls.length} ops</span>
        <span className="tool-inline-kinds">
          {kindSummary.map((item) => (
            <span key={item.kind} className="tool-inline-kind-entry">
              <Icon name={item.icon} size="sm" />
              <span className="tool-inline-kind-count">×{item.count}</span>
            </span>
          ))}
        </span>
        {locations.length > 0 && (
          <span className="tool-inline-locations">
            {locations.slice(0, 2).map((loc, idx) => {
              const ext = getFileExtension(loc.path);
              const bname = loc.path.split("/").pop() ?? loc.path;
              return (
                <span
                  key={`${loc.path}:${loc.line ?? 0}-${idx}`}
                  className="tool-inline-file"
                  onClick={(e) => { e.stopPropagation(); handleFileClick(loc.path, loc.line); }}
                  title={loc.line ? `${loc.path}:${loc.line}` : loc.path}
                >
                  <span className="file-chip-ext">{fileIcon(ext)}</span>
                  <span className="file-chip-label">{bname}{loc.line ? `:${loc.line}` : ""}</span>
                </span>
              );
            })}
            {locations.length > 2 && (
              <span className="tool-inline-more">+{locations.length - 2}</span>
            )}
          </span>
        )}
        <span className="tool-inline-duration">{formatDuration(totalMs)}</span>
        <span className={`tool-chevron ${expanded ? "open" : ""}`} aria-hidden="true">▶</span>
      </button>
      {expanded && (
        <div className="tool-inline-expanded">
          {hasErrors ? (
            <>
              {errors.map((call) => (
                <div key={call.id} className="tool-inline-error-item">
                  <ToolCallCard {...call} />
                </div>
              ))}
              {ok.length > 0 && (
                <div className="tool-inline-item">
                  <ToolInlineSummary calls={ok} />
                </div>
              )}
            </>
          ) : (
            calls.map((call) => (
              <div key={call.id} className="tool-inline-item">
                <ToolCallCard {...call} />
              </div>
            ))
          )}
        </div>
      )}
    </span>
  );
}
