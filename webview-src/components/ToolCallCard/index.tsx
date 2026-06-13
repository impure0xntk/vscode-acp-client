import React, { useState } from "react";
import type { ToolCallDiffContent, ToolCall } from "../../types";
import { StatusIcon } from "../StatusIcon";
import { getVsCodeApi } from "../../lib/vscodeApi";

export { ToolBatchSummary } from "./ToolBatchSummary";
export { ToolBatchItem } from "./ToolBatchItem";

// ── Shared helpers ─────────────────────────────────────────────────────────

export function getFileExtension(path: string): string {
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? path;
  const dotIdx = filename.lastIndexOf(".");
  return dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : "";
}

export function fileIcon(ext: string): string {
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx": return "TS";
    case "py": return "PY";
    case "rs": return "RS";
    case "go": return "GO";
    case "java": return "JV";
    case "c": case "cpp": case "h": case "hpp": return "C";
    case "md": return "MD";
    case "json": return "{}";
    case "yaml": case "yml": return "Y";
    case "toml": return "T";
    case "nix": return "N";
    default: return "•";
  }
}

export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function tryFormatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function resolveKind(kind: string | undefined): string {
  if (kind && kind.trim()) return kind.trim();
  return "tool_call";
}

// ── Chevron ─────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <span className={`tool-chevron ${open ? "open" : ""}`} aria-hidden="true">
      ▶
    </span>
  );
}

// ── DiffView ────────────────────────────────────────────────────────────────

export function DiffView({ diff }: { diff: ToolCallDiffContent }): React.ReactElement {
  const lines: Array<{ prefix: string; text: string }> = [];
  const diffLines = (diff.diff ?? "").split("\n");

  const maxLines = 200;
  let truncated = false;

  for (const l of diffLines) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    const prefix = l.startsWith("-") ? "-" : l.startsWith("+") ? "+" : " ";
    lines.push({ prefix, text: l });
  }

  if (truncated) {
    lines.push({ prefix: "…", text: "(truncated)" });
  }

  return (
    <div className="diff-view">
      <pre className="diff-content">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.prefix === "-"
                ? "diff-line-removed"
                : l.prefix === "+"
                  ? "diff-line-added"
                  : "diff-line-meta"
            }
          >
            <span className="diff-prefix">{l.prefix}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

// ── ToolCallLocation ───────────────────────────────────────────────────────

interface ToolCallLocation {
  path: string;
  line?: number;
}

// ── ToolCallCard ───────────────────────────────────────────────────────────

export interface ToolCallCardProps {
  id: string;
  title: string;
  kind?: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  input?: Record<string, unknown> | string;
  output?: string;
  durationMs?: number;
  locations?: ToolCallLocation[];
  diffContent?: ToolCallDiffContent;
}

export function ToolCallCard({
  title,
  kind,
  status,
  input,
  output,
  durationMs,
  locations,
  diffContent,
}: ToolCallCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const displayKind = resolveKind(kind);

  const hasInput = input !== undefined;
  const hasOutput = output !== undefined;
  const hasDiff = diffContent !== undefined;
  const hasLocations = locations && locations.length > 0;
  const hasBody = hasInput || hasOutput || hasDiff;

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
        <span className="tool-kind">{displayKind}</span>
        <span className="tool-title">{title}</span>
        {hasLocations &&
          locations.map((loc, idx) => {
            const basename = loc.path.split("/").pop() ?? loc.path;
            const ext = getFileExtension(loc.path);
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
        {durationMs !== undefined && (
          <span className="tool-duration">{formatDuration(durationMs)}</span>
        )}
        {hasBody && <Chevron open={expanded} />}
      </button>

      {expanded && (
        <div className="tool-call-body">
          {hasDiff && (
            <div className="tool-section">
              <button
                className="tool-section-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setDiffOpen(!diffOpen);
                }}
                aria-expanded={diffOpen}
              >
                <Chevron open={diffOpen} />
                <span className="tool-section-label">Diff</span>
              </button>
              {diffOpen && <DiffView diff={diffContent} />}
            </div>
          )}
          {hasInput && (
            <div className="tool-section">
              <button
                className="tool-section-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setInputOpen(!inputOpen);
                }}
                aria-expanded={inputOpen}
              >
                <Chevron open={inputOpen} />
                <span className="tool-section-label">Input</span>
              </button>
              {inputOpen && (
                <pre className="tool-content">
                  <code>
                    {typeof input === "string"
                      ? tryFormatJson(input)
                      : JSON.stringify(input, null, 2)}
                  </code>
                </pre>
              )}
            </div>
          )}
          {hasOutput && (
            <div className="tool-section">
              <button
                className="tool-section-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setOutputOpen(!outputOpen);
                }}
                aria-expanded={outputOpen}
              >
                <Chevron open={outputOpen} />
                <span className="tool-section-label">Output</span>
              </button>
              {outputOpen && (
                <pre className="tool-content">
                  <code>
                    {typeof output === "string"
                      ? tryFormatJson(output)
                      : String(output)}
                  </code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GroupedToolCallCard ─────────────────────────────────────────────────────

export interface GroupedToolCallCardProps {
  kind?: string;
  count: number;
  calls: ToolCallCardProps[];
}

type GroupedStatus = ToolCallCardProps["status"] | "warning";

function aggregateStatus(calls: ToolCallCardProps[]): GroupedStatus {
  const statuses = calls.map((c) => c.status);
  if (statuses.some((s) => s === "in_progress")) return "in_progress";
  if (statuses.some((s) => s === "failed")) {
    return statuses.every((s) => s === "failed") ? "failed" : "warning";
  }
  if (statuses.some((s) => s === "cancelled")) return "cancelled";
  return "completed";
}

function collectUniqueFiles(calls: ToolCallCardProps[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const call of calls) {
    const loc = call.locations?.[0];
    if (!loc) continue;
    const path = loc.path;
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

export function GroupedToolCallCard({
  kind,
  count,
  calls,
}: GroupedToolCallCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const status = aggregateStatus(calls);
  const uniqueFiles = collectUniqueFiles(calls);

  const handleFileClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      getVsCodeApi().postMessage({ type: "openFile", path });
    } catch {
      /* vscodeApi not available */
    }
  };

  return (
    <div className={`tool-call-group tool-call-group-${status}`}>
      <button
        className="tool-group-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="tool-status-icon">
          <StatusIcon status={status} />
        </span>
        <span className="tool-kind">{kind}</span>
        <span className="tool-group-count">×{count}</span>
        {uniqueFiles.length > 0 &&
          uniqueFiles.map((path, idx) => {
            const ext = getFileExtension(path);
            const basename = path.split("/").pop() ?? path;
            return (
              <span
                key={`${path}-${idx}`}
                className="tool-group-file-chip tool-group-file-chip-inline"
                onClick={(e) => handleFileClick(e, path)}
                title={path}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    try {
                      getVsCodeApi().postMessage({ type: "openFile", path });
                    } catch {
                      /* */
                    }
                  }
                }}
              >
                <span className="tool-group-file-icon">{fileIcon(ext)}</span>
                <span className="tool-group-file-name">{basename}</span>
              </span>
            );
          })}
        <Chevron open={expanded} />
      </button>

      {expanded && (
        <div className="tool-group-body">
          {calls.map((call) => (
            <div key={call.id} className="tool-group-item">
              <ToolCallCard {...call} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
