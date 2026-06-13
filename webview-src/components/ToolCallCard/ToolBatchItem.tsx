import React from "react";
import { Icon } from "../../lib/icons";
import { kindIconName } from "../../util/toolBatchSummary";
import type { ToolCall } from "../../types";

interface ToolBatchItemProps {
  call: ToolCall;
}

function extractLabel(call: ToolCall): string {
  if (call.kind && call.kind.trim()) return call.kind.trim();
  return "tool_call";
}

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

function extractSize(call: ToolCall): string | null {
  if (call.output && typeof call.output === "string") {
    const bytes = call.output.length;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
  }
  return null;
}

export function ToolBatchItem({ call }: ToolBatchItemProps): React.ReactElement {
  const iconName = kindIconName(call.kind ?? "tool_call");
  const label = extractLabel(call);
  const filePath = extractFilePath(call);
  const basename = filePath ? (filePath.split("/").pop() ?? filePath) : null;
  const size = extractSize(call);
  const statusIcon =
    call.status === "completed" ? "check" : call.status === "failed" ? "close" : "loading";

  return (
    <div className="tool-batch-item">
      <Icon name={iconName} size="sm" className="tool-batch-item-icon" />
      <span className="tool-batch-item-kind">{label}</span>
      {basename && (
        <span className="tool-batch-item-file">
          {filePath !== basename ? `…/${basename}` : basename}
        </span>
      )}
      <Icon name={statusIcon} size="sm" className="tool-batch-item-status" />
      {size !== null && (
        <span className="tool-batch-item-size">{size}</span>
      )}
      {call.durationMs !== undefined && (
        <span className="tool-batch-item-duration">
          {call.durationMs >= 1000
            ? `${(call.durationMs / 1000).toFixed(1)}s`
            : `${Math.round(call.durationMs)}ms`}
        </span>
      )}
    </div>
  );
}
