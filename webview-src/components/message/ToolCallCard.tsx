import React, { useState } from "react";
import type { ToolCallDiffContent, ToolCall } from "../../types";
import { StatusIcon } from "../primitives/StatusIcon";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { Icon, iconForToolKind } from "../../lib/icons";
import { getLogger } from "../../lib/logger";

const log = getLogger("webview.ToolCallCard");
// ── Shared helpers ─────────────────────────────────────────────────────────

export function getFileExtension(path: string): string {
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? path;
  const dotIdx = filename.lastIndexOf(".");
  return dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : "";
}

export function fileIcon(ext: string): string {
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return "TS";
    case "py":
      return "PY";
    case "rs":
      return "RS";
    case "go":
      return "GO";
    case "java":
      return "JV";
    case "c":
    case "cpp":
    case "h":
    case "hpp":
      return "C";
    case "md":
      return "MD";
    case "json":
      return "{}";
    case "yaml":
    case "yml":
      return "Y";
    case "toml":
      return "T";
    case "nix":
      return "N";
    default:
      return "•";
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

// ── Chevron ─────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <span
      className={`flex-shrink-0 text-[9px] opacity-60 transition-transform duration-150${open ? " rotate-90" : ""}`}
      aria-hidden="true"
    >
      ▶
    </span>
  );
}

// ── DiffView ────────────────────────────────────────────────────────────────

export function DiffView({
  diff,
}: {
  diff: ToolCallDiffContent;
}): React.ReactElement {
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
    <div className="mb-2">
      <pre className="mt-1 p-1.5 bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded font-mono text-[11px] leading-[1.5] overflow-x-auto max-h-[300px] overflow-y-auto">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.prefix === "-"
                ? "bg-[rgba(241,76,76,0.15)] text-[#f48771]"
                : l.prefix === "+"
                  ? "bg-[rgba(78,201,176,0.15)] text-[#89d185]"
                  : "text-fg-secondary"
            }
          >
            <span className="inline-block w-4 select-none">{l.prefix}</span>
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
    <div
      className={`mt-0 max-w-full rounded overflow-hidden text-[10px] bg-[color-mix(in_srgb,var(--bg-secondary)_6%,transparent)]${status === "completed" ? " opacity-[0.7] data-[completed=true]" : ""}`}
      data-completed={status === "completed" ? "true" : undefined}
    >
      <button
        className={`flex items-center gap-[3px] px-1.25 font-mono text-[10px] text-fg-primary w-fit max-w-full border-none bg-transparent text-left transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]${hasBody ? " cursor-pointer" : ""}`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {hasBody && <Chevron open={expanded} />}
        <span className="text-xs flex-shrink-0">
          <StatusIcon status={status} variant="tool" />
        </span>
        <Icon
          name={iconForToolKind(kind ?? "tool_call")}
          size="sm"
          className="inline-flex items-center flex-shrink-0 opacity-80"
        />
        <span className="text-fg-primary text-[9px] uppercase flex-shrink-0 whitespace-nowrap opacity-70">
          {(kind ?? "TOOL_CALL").toUpperCase()}
        </span>
        <span className="font-normal text-[10px] text-fg-primary flex-shrink-0 whitespace-nowrap">
          {title}
        </span>
        {hasLocations &&
          locations.map((loc, idx) => {
            const basename = loc.path.split("/").pop() ?? loc.path;
            const ext = getFileExtension(loc.path);
            return (
              <span
                key={`${loc.path}:${loc.line ?? 0}-${idx}`}
                className={`inline-flex items-center gap-0.5 px-0.75 py-px rounded-[3px] bg-bg-secondary ${status === "completed" ? "text-fg-secondary hover:text-fg-primary" : "text-fg-primary"} text-[9px] cursor-pointer select-none transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1 flex-shrink-0 ml-[2px]`}
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
                <span className={`inline-flex items-center justify-center w-[14px] h-[11px] rounded-[2px] font-mono text-[12px] font-bold leading-none tracking-[-0.3px] flex-shrink-0 ${status === "completed" ? "text-fg-muted bg-[color-mix(in_srgb,var(--fg-muted)_12%,transparent)] hover:text-fg-secondary hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]" : "bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-fg-secondary"}`}>{fileIcon(ext)}</span>
                <span className="leading-none">
                  {basename}
                  {loc.line ? `:${loc.line}` : ""}
                </span>
              </span>
            );
          })}
        <span className="font-mono text-[9px] text-fg-secondary whitespace-nowrap flex-shrink-0">
          {formatDuration(durationMs ?? 0)}
        </span>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-1.25 pb-0.5 pt-px bg-[color-mix(in_srgb,var(--bg-secondary)_8%,transparent)]">
            {hasDiff && (
              <div className="mt-[1px] first:mt-0">
                <button
                  className="inline-flex items-center gap-[3px] px-0.75 py-px rounded border-none bg-transparent text-fg-muted text-[10px] font-[var(--font-ui)] cursor-pointer leading-[1.3] transition-colors duration-150 hover:text-fg-secondary hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDiffOpen(!diffOpen);
                  }}
                  aria-expanded={diffOpen}
                >
                  <Chevron open={diffOpen} />
                  <span className="text-[10px]">Diff</span>
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${diffOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  <div className="overflow-hidden">
                    <DiffView diff={diffContent} />
                  </div>
                </div>
              </div>
            )}
            {hasInput && (
              <div className="mt-[1px] first:mt-0">
                <button
                  className="inline-flex items-center gap-[3px] px-0.75 py-px rounded border-none bg-transparent text-fg-muted text-[10px] font-[var(--font-ui)] cursor-pointer leading-[1.3] transition-colors duration-150 hover:text-fg-secondary hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInputOpen(!inputOpen);
                  }}
                  aria-expanded={inputOpen}
                >
                  <Chevron open={inputOpen} />
                  <span className="text-[10px]">Input</span>
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${inputOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  <div className="overflow-hidden">
                    <pre className="font-mono text-[10px] whitespace-pre-wrap text-fg-secondary mt-[1px] mb-0 p-[3px_5px] bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded">
                      <code>
                        {typeof input === "string"
                          ? tryFormatJson(input)
                          : JSON.stringify(input, null, 2)}
                      </code>
                    </pre>
                  </div>
                </div>
              </div>
            )}
            {hasOutput && (
              <div className="mt-[1px] first:mt-0">
                <button
                  className="inline-flex items-center gap-[3px] px-0.75 py-px rounded border-none bg-transparent text-fg-muted text-[10px] font-[var(--font-ui)] cursor-pointer leading-[1.3] transition-colors duration-150 hover:text-fg-secondary hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOutputOpen(!outputOpen);
                  }}
                  aria-expanded={outputOpen}
                >
                  <Chevron open={outputOpen} />
                  <span className="text-[10px]">Output</span>
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${outputOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  <div className="overflow-hidden">
                    <pre className="font-mono text-[10px] whitespace-pre-wrap text-fg-secondary mt-[1px] mb-0 p-[3px_5px] bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded">
                      <code>
                        {typeof output === "string"
                          ? tryFormatJson(output)
                          : String(output)}
                      </code>
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
