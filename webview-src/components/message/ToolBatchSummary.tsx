import React, { useState, useMemo } from "react";
import type { ToolCallCardProps } from "./ToolCallCard";
import { ToolCallCard, formatDuration } from "./ToolCallCard";

import { StatusIcon } from "../primitives/StatusIcon";
import { summarizeKinds } from "../../util/toolBatchSummary";
import { Icon } from "../../lib/icons";

type SummaryStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "warning";

function aggregateStatuses(calls: ToolCallCardProps[]): SummaryStatus {
  const statuses = calls.map((c) => c.status);
  if (statuses.some((s) => s === "in_progress")) return "in_progress";
  if (statuses.some((s) => s === "failed"))
    return statuses.every((s) => s === "failed") ? "failed" : "warning";
  if (statuses.some((s) => s === "cancelled")) return "cancelled";
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

function partitionErrors(calls: ToolCallCardProps[]): {
  errors: ToolCallCardProps[];
  ok: ToolCallCardProps[];
} {
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

export interface ToolBatchSummaryProps {
  calls: ToolCallCardProps[];
  /** When true, apply appear animation */
  isNew?: boolean;
}

/** Errors group — always expanded, no collapsible chrome */
function ErrorsGroup({
  errors,
}: {
  errors: ToolCallCardProps[];
}): React.ReactElement {
  return (
    <>
      {errors.map((call) => (
        <div key={call.id} className="tool-batch-item tool-batch-error-item">
          <ToolCallCard {...call} />
        </div>
      ))}
    </>
  );
}

export function ToolBatchSummary({
  calls,
  isNew = false,
}: ToolBatchSummaryProps): React.ReactElement {
  const hasErrors = calls.some((c) => c.status === "failed");
  const hasOnlyErrors = hasErrors && calls.every((c) => c.status === "failed");

  const status = useMemo(() => aggregateStatuses(calls), [calls]);
  const kindSummary = useMemo(() => summarizeKinds(countKinds(calls)), [calls]);
  const totalOps = calls.length;
  const totalMs = useMemo(() => totalDuration(calls), [calls]);

  const appearClass = isNew ? "tool-batch--appear" : "";

  // ── Single call: render directly, no wrapper ──
  if (calls.length === 1) {
    return (
      <div className={`tool-batch-item ${appearClass}`}>
        <ToolCallCard {...calls[0]} />
      </div>
    );
  }

  // ── All-same-status: single collapsible via chevron ──
  if (!hasErrors || hasOnlyErrors) {
    const [expanded, setExpanded] = useState(false);

    return (
      <div
        className={`tool-batch${expanded ? " tool-batch-expanded" : ""} tool-call-${status} ${appearClass}`}
      >
        <button
          className="tool-batch-header"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span
            className={`tool-chevron ${expanded ? "open" : ""}`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="tool-status-icon">
            <StatusIcon status={status} variant="tool" />
          </span>
          <span className="tool-batch-ops">{totalOps} ops</span>
          <span className="tool-batch-kinds">
            {kindSummary.map((item) => (
              <span key={item.kind} className="tool-batch-kind-entry">
                <Icon
                  name={item.icon}
                  size="sm"
                  className="tool-batch-kind-icon"
                />
                <span className="tool-batch-kind-abbr">{item.abbr}</span>
                <span className="tool-batch-kind-count">×{item.count}</span>
              </span>
            ))}
          </span>
          <span className="tool-batch-duration">{formatDuration(totalMs)}</span>
        </button>

        <div className={`collapsible ${expanded ? "collapsible--open" : ""}`}>
          <div className="collapsible-body">
            <div className="tool-batch-body">
              {calls.map((call) => (
                <div key={call.id} className="tool-batch-item">
                  <ToolCallCard {...call} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Mixed (errors + ok): top-level chevron collapses everything ──
  const { errors, ok } = useMemo(() => partitionErrors(calls), [calls]);

  // Top-level: auto-expand on render when errors present
  const [allExpanded, setAllExpanded] = useState(true);

  return (
    <div
      className={`tool-batch${allExpanded ? " tool-batch-expanded" : ""} tool-call-${status} ${appearClass}`}
    >
      {/* Top-level chevron toggles entire batch */}
      <button
        className="tool-batch-header"
        onClick={() => setAllExpanded(!allExpanded)}
        aria-expanded={allExpanded}
      >
        <span
          className={`tool-chevron ${allExpanded ? "open" : ""}`}
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="tool-status-icon">
          <StatusIcon status={status} variant="tool" />
        </span>
        <span className="tool-batch-ops">{totalOps} ops</span>
        <span className="tool-batch-kinds">
          {kindSummary.map((item) => (
            <span key={item.kind} className="tool-batch-kind-entry">
              <Icon
                name={item.icon}
                size="sm"
                className="tool-batch-kind-icon"
              />
              <span className="tool-batch-kind-abbr">{item.abbr}</span>
              <span className="tool-batch-kind-count">×{item.count}</span>
            </span>
          ))}
        </span>
        <span className="tool-batch-duration">{formatDuration(totalMs)}</span>
      </button>

      <div className={`collapsible ${allExpanded ? "collapsible--open" : ""}`}>
        <div className="collapsible-body">
          <div className="tool-batch-body">
            {/* Errors — always expanded, no nested chevron */}
            <ErrorsGroup errors={errors} />

            {/* Ok sub-group — recursive ToolBatchSummary for uniform rendering */}
            {ok.length > 0 && (
              <div className="tool-batch-nested-ok">
                <ToolBatchSummary calls={ok} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
