import React, { useState } from "react";
import type { ToolCallCardProps } from "./index";
import { ToolCallCard, getFileExtension, fileIcon } from "./index";
import { StatusIcon } from "../StatusIcon";
import { Icon, iconForToolKind } from "../../lib/icons";
import { getVsCodeApi } from "../../lib/vscodeApi";

// ── Shared types ──────────────────────────────────────────────────────────

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

// ── Props ─────────────────────────────────────────────────────────────────

export interface GroupedToolCallCardProps {
  kind?: string;
  count: number;
  calls: ToolCallCardProps[];
}

// ── Component ─────────────────────────────────────────────────────────────

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
        <Icon name={iconForToolKind(kind ?? "")} size="sm" className="tool-group-kind-icon" />
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
        <span className="tool-chevron" aria-hidden="true">
          ▶
        </span>
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
