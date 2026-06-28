import React, { useState, useMemo } from "react";
import type { ToolCallCardProps } from "./ToolCallCard";
import { ToolCallCard, formatDuration } from "./ToolCallCard";

import { StatusIcon } from "../primitives/StatusIcon";
import { summarizeKinds } from "../../lib/toolKindSummary";
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
  /** Indent level for recursive nesting */
  depth?: number;
}

const INDENT_PX = 12;

/** Errors group — always expanded, no collapsible chrome */
function ErrorsGroup({
  errors,
  depth,
}: {
  errors: ToolCallCardProps[];
  depth: number;
}): React.ReactElement {
  const paddingLeft = depth > 0 ? `${INDENT_PX}px` : "6px";
  return (
    <>
      {errors.map((call) => (
        <div
          key={call.id}
          className="flex items-center gap-1 px-0.75 py-px text-[9px] font-mono text-fg-secondary rounded-[2px] hover:bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)]"
          style={{ paddingLeft }}
        >
          <ToolCallCard {...call} />
        </div>
      ))}
    </>
  );
}

export function ToolBatchSummary({
  calls,
  isNew = false,
  depth = 0,
}: ToolBatchSummaryProps): React.ReactElement {
  const hasErrors = calls.some((c) => c.status === "failed");
  const hasOnlyErrors = hasErrors && calls.every((c) => c.status === "failed");

  const status = useMemo(() => aggregateStatuses(calls), [calls]);
  const kindSummary = useMemo(() => summarizeKinds(countKinds(calls)), [calls]);
  const totalOps = calls.length;
  const totalMs = useMemo(() => totalDuration(calls), [calls]);
  const { errors, ok } = useMemo(() => partitionErrors(calls), [calls]);

  const appearClass = isNew ? "animate-tool-batch-appear" : "";

  // All-error batches auto-expand so failures are immediately visible,
  // matching the mixed-errors behaviour.
  const [expanded, setExpanded] = useState(() => hasOnlyErrors);
  const [allExpanded, setAllExpanded] = useState(() => true);

  // ── Single call: render directly, no wrapper ──
  if (calls.length === 1) {
    return (
      <div
        className={`flex items-center gap-1 pl-1.5 px-0.75 py-px text-[9px] font-mono text-fg-secondary rounded-[2px] hover:bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)] ${appearClass}`}
      >
        <ToolCallCard {...calls[0]} />
      </div>
    );
  }

  // ── All-same-status: single collapsible via chevron ──
  if (!hasErrors || hasOnlyErrors) {
    return (
      <div
        className={`${expanded ? "overflow-visible" : ""} ${appearClass} mt-[2px] rounded overflow-hidden text-[10px] text-fg-primary bg-[color-mix(in_srgb,var(--bg-secondary)_6%,transparent)]`}
      >
        <button
          className="flex items-center gap-[3px] px-1.25 w-fit max-w-full border-none bg-transparent text-fg-primary font-[var(--font-ui)] text-[10px] cursor-pointer text-left transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span
            className={`flex-shrink-0 text-[9px] opacity-60 transition-transform duration-150${expanded ? " rotate-90" : ""}`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="text-xs flex-shrink-0">
            <StatusIcon status={status} variant="tool" />
          </span>
          <span className="font-semibold text-[9px] text-fg-primary whitespace-nowrap flex-shrink-0 px-0.75 py-px rounded bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)]">
            {totalOps} ops
          </span>
          <span className="text-fg-secondary font-mono text-[10px] whitespace-nowrap">
            {kindSummary.map((item) => (
              <span
                key={item.kind}
                className="inline-flex items-center gap-0.5 font-mono text-[9px] text-fg-secondary whitespace-nowrap mr-[3px] px-0.75 py-px rounded bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)]"
              >
                <Icon
                  name={item.icon}
                  size="sm"
                  className="inline-flex items-center flex-shrink-0 opacity-80"
                />
                <span className="uppercase font-semibold text-[9px] text-fg-secondary">
                  {item.abbr}
                </span>
                <span className="font-semibold text-fg-secondary text-[9px]">
                  ×{item.count}
                </span>
              </span>
            ))}
          </span>
          <span className="font-mono text-[9px] text-fg-secondary whitespace-nowrap flex-shrink-0">
            {formatDuration(totalMs)}
          </span>
        </button>

        <div className={`grid transition-[grid-template-rows] duration-200 ease-out${expanded ? " grid-rows-[1fr]" : " grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="px-2 pb-0.5 pt-px flex flex-col gap-[1px] bg-[color-mix(in_srgb,var(--bg-secondary)_8%,transparent)] animate-tool-batch-expand">
              {calls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center gap-1 px-0.75 py-px text-[9px] font-mono text-fg-secondary rounded-[2px] hover:bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)]"
                  style={{ paddingLeft: `${6 + (depth > 0 ? INDENT_PX : 0)}px` }}
                >
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

  return (
    <div
      className={`${allExpanded ? " overflow-visible" : ""} ${appearClass} mt-[2px] rounded overflow-hidden text-[10px] text-fg-primary bg-[color-mix(in_srgb,var(--bg-secondary)_6%,transparent)]`}
    >
      {/* Top-level chevron toggles entire batch */}
      <button
        className="flex items-center gap-[3px] px-1.25 w-fit max-w-full border-none bg-transparent text-fg-primary font-[var(--font-ui)] text-[10px] cursor-pointer text-left transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
        onClick={() => setAllExpanded(!allExpanded)}
        aria-expanded={allExpanded}
      >
        <span
          className={`flex-shrink-0 text-[9px] opacity-60 transition-transform duration-150${allExpanded ? " rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="text-xs flex-shrink-0">
          <StatusIcon status={status} variant="tool" />
        </span>
        <span className="font-semibold text-[9px] text-fg-primary whitespace-nowrap flex-shrink-0 px-0.75 py-px rounded bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)]">
          {totalOps} ops
        </span>
        <span className="text-fg-secondary font-mono text-[10px] whitespace-nowrap">
          {kindSummary.map((item) => (
            <span
              key={item.kind}
              className="inline-flex items-center gap-0.5 font-mono text-[9px] text-fg-secondary whitespace-nowrap mr-[3px] px-0.75 py-px rounded bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)]"
            >
              <Icon
                name={item.icon}
                size="sm"
                className="inline-flex items-center flex-shrink-0 opacity-80"
              />
              <span className="uppercase font-semibold text-[9px] text-fg-secondary">
                {item.abbr}
              </span>
              <span className="font-semibold text-fg-secondary text-[9px]">
                ×{item.count}
              </span>
            </span>
          ))}
        </span>
        <span className="font-mono text-[9px] text-fg-secondary whitespace-nowrap flex-shrink-0">
          {formatDuration(totalMs)}
        </span>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-out${allExpanded ? " grid-rows-[1fr]" : " grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-2 pb-0.5 pt-px flex flex-col gap-[1px] bg-[color-mix(in_srgb,var(--bg-secondary)_8%,transparent)] animate-tool-batch-expand">
            {/* Errors — always expanded, no nested chevron */}
            <ErrorsGroup errors={errors} depth={depth + 1} />

            {/* Ok sub-group — recursive ToolBatchSummary for uniform rendering */}
            {ok.length > 0 && (
              <ToolBatchSummary calls={ok} depth={depth + 1} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
