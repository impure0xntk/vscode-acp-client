import React, { useState } from "react";
import { Icon } from "../../lib/icons";
import { ToolBatchItem } from "./ToolBatchItem";
import {
  computeBatchSummary,
  kindIconName,
  formatKindCounts,
  formatDurationMs,
} from "../../util/toolBatchSummary";
import type { ToolCall } from "../../types";

export interface ToolBatchSummaryProps {
  calls: ToolCall[];
  defaultExpanded?: boolean;
  maxFilesInSummary?: number;
  showDuration?: boolean;
  showKindCounts?: boolean;
}

export function ToolBatchSummary({
  calls,
  defaultExpanded = false,
  maxFilesInSummary = 3,
  showDuration = true,
  showKindCounts = true,
}: ToolBatchSummaryProps): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = computeBatchSummary(calls);

  const iconName = kindIconName(summary.dominantKind);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded(!expanded);
    }
    if (e.key === "Escape" && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  };

  return (
    <div className={`tool-batch${summary.hasErrors ? " tool-batch--has-errors" : ""}`}>
      <button
        className="tool-batch-header"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
      >
        <Icon name={iconName} size="sm" className="tool-batch-icon" />
        <span className="tool-batch-count">{summary.totalCount} ops</span>
        {summary.uniqueFiles.length > 0 && (
          <>
            <span className="tool-batch-sep">·</span>
            <span className="tool-batch-files">
              {summary.uniqueFiles.length} file{summary.uniqueFiles.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
        {showKindCounts && Object.keys(summary.kindCounts).length > 0 && (
          <>
            <span className="tool-batch-sep">·</span>
            <span className="tool-batch-kinds">{formatKindCounts(summary.kindCounts)}</span>
          </>
        )}
        {showDuration && summary.totalDurationMs > 0 && (
          <>
            <span className="tool-batch-sep">·</span>
            <span className="tool-batch-duration">{formatDurationMs(summary.totalDurationMs)}</span>
          </>
        )}
        {summary.hasErrors && (
          <span className="tool-batch-error-indicator" title="Contains errors">
            <Icon name="warning" size="sm" />
          </span>
        )}
        <span className="tool-batch-chevron">
          {expanded
            ? <Icon name="chevron-down" size="sm" />
            : <Icon name="chevron-right" size="sm" />}
        </span>
      </button>

      {expanded && (
        <div className="tool-batch-body">
          {calls.map((call) => (
            <ToolBatchItem key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
