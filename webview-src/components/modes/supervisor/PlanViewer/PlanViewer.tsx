import React, { useCallback, useState } from "react";
import type { Plan, PlanStep } from "../../../../types";
import { PlanStepView } from "./PlanStep";
import { Icon } from "../../../../lib/icons";

export interface PlanViewerProps {
  plan: Plan | null;
  onApprove: () => void;
  onReject: () => void;
  onModifyStep: (stepId: string, newDescription: string) => void;
  onAddStep: (description: string, afterStepId?: string) => void;
  onRemoveStep: (stepId: string) => void;
  onCancel: () => void;
  onClose: () => void;
  onReplan?: (failedStepId: string, reason: string) => void;
}

export function PlanViewer({
  plan,
  onApprove,
  onReject,
  onModifyStep,
  onAddStep,
  onRemoveStep,
  onCancel,
  onClose,
  onReplan,
}: PlanViewerProps): React.ReactElement | null {
  const [addingAfter, setAddingAfter] = useState<string | null>(null);
  const [newStepText, setNewStepText] = useState("");

  const handleStartAdd = useCallback((afterStepId?: string) => {
    setAddingAfter(afterStepId ?? "");
    setNewStepText("");
  }, []);

  const handleCommitAdd = useCallback(() => {
    const trimmed = newStepText.trim();
    if (!trimmed) {
      setAddingAfter(null);
      return;
    }
    onAddStep(trimmed, addingAfter || undefined);
    setAddingAfter(null);
    setNewStepText("");
  }, [newStepText, addingAfter, onAddStep]);

  const handleCancelAdd = useCallback(() => {
    setAddingAfter(null);
    setNewStepText("");
  }, []);

  if (!plan) return null;

  const completedCount = plan.steps.filter(
    (s) => s.status === "completed"
  ).length;
  const totalSteps = plan.steps.length;
  const progressPct =
    totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const failedSteps = plan.steps.filter((s) => s.status === "failed");

  return (
    <div className="flex flex-col px-3.5 py-2 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
          <Icon name="list-tree" size="sm" />
          <span>Execution Plan</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] px-1.5 py-px rounded font-mono whitespace-nowrap${plan.status === "pending" ? " bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-warning" : plan.status === "approved" ? " bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-accent" : plan.status === "executing" ? " bg-[color-mix(in_srgb,#4fc3f7_15%,transparent)] text-[#4fc3f7]" : plan.status === "completed" ? " bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]" : plan.status === "failed" ? " bg-[color-mix(in_srgb,var(--error)_15%,transparent)] text-error" : plan.status === "rejected" || plan.status === "cancelled" ? " bg-[color-mix(in_srgb,var(--fg-muted)_15%,transparent)] text-fg-muted" : plan.status === "draft" ? " bg-[color-mix(in_srgb,var(--fg-muted)_10%,transparent)] text-fg-muted" : ""}`}
          >
            {plan.status === "executing"
              ? `Executing (${completedCount}/${totalSteps})`
              : plan.status === "completed"
                ? "Completed"
                : plan.status === "failed"
                  ? "Failed"
                  : plan.status === "cancelled"
                    ? "Cancelled"
                    : plan.status === "approved"
                      ? "Approved — executing..."
                      : plan.status === "rejected"
                        ? "Rejected"
                        : plan.status === "draft"
                          ? "Draft"
                          : "Pending approval"}
          </span>
          <button
            className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer transition-colors duration-150 hover:bg-error hover:text-user-fg"
            onClick={onClose}
            type="button"
            aria-label="Close plan"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      </div>

      {(plan.status === "executing" || plan.status === "approved") && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-sm bg-border overflow-hidden">
            <div
              className="h-full rounded-sm bg-accent transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] text-fg-muted font-mono whitespace-nowrap">
            {completedCount}/{totalSteps} steps
          </span>
        </div>
      )}

      <div className="flex flex-col gap-[2px]">
        {plan.steps.map((step) => (
          <React.Fragment key={step.id}>
            <PlanStepView
              step={step}
              index={step.index}
              canModify={plan.status === "pending"}
              onModify={(newDesc) => onModifyStep(step.id, newDesc)}
              onRemove={
                plan.status === "pending"
                  ? () => onRemoveStep(step.id)
                  : undefined
              }
              onStartAddAfter={() => handleStartAdd(step.id)}
              onReplan={
                onReplan && step.status === "failed"
                  ? () => onReplan(step.id, step.error ?? "Step failed")
                  : undefined
              }
            />
            {addingAfter === step.id && (
              <div className="flex items-center gap-1 p-1 ml-6">
                <input
                  className="flex-1 px-1.5 py-0.5 border border-border rounded-[3px] bg-bg-input text-fg-primary text-[11px] outline-none focus:border-accent"
                  value={newStepText}
                  onChange={(e) => setNewStepText(e.target.value)}
                  placeholder="Step description..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommitAdd();
                    if (e.key === "Escape") handleCancelAdd();
                  }}
                />
                <button
                  className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-success hover:text-user-fg"
                  onClick={handleCommitAdd}
                  type="button"
                >
                  <Icon name="check" size="sm" />
                </button>
                <button
                  className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-error hover:text-user-fg"
                  onClick={handleCancelAdd}
                  type="button"
                >
                  <Icon name="close" size="sm" />
                </button>
              </div>
            )}
          </React.Fragment>
        ))}

        {plan.status === "pending" && (
          <>
            {addingAfter === "" ? (
              <div className="flex items-center gap-1 p-1 ml-6">
                <input
                  className="flex-1 px-1.5 py-0.5 border border-border rounded-[3px] bg-bg-input text-fg-primary text-[11px] outline-none focus:border-accent"
                  value={newStepText}
                  onChange={(e) => setNewStepText(e.target.value)}
                  placeholder="Step description..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommitAdd();
                    if (e.key === "Escape") handleCancelAdd();
                  }}
                />
                <button
                  className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-success hover:text-user-fg"
                  onClick={handleCommitAdd}
                  type="button"
                >
                  <Icon name="check" size="sm" />
                </button>
                <button
                  className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-error hover:text-user-fg"
                  onClick={handleCancelAdd}
                  type="button"
                >
                  <Icon name="close" size="sm" />
                </button>
              </div>
            ) : (
              <button
                className="inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-border rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer ml-6 transition-colors duration-150 hover:bg-accent-hover hover:text-fg-primary hover:border-accent"
                onClick={() => handleStartAdd()}
                type="button"
              >
                <Icon name="plus" size="sm" />
                Add step
              </button>
            )}
          </>
        )}
      </div>

      {plan.status === "pending" && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <button
            className="inline-flex items-center gap-1 px-3 py-1 border border-success rounded-md text-[11px] cursor-pointer transition-colors duration-150 bg-success text-[var(--bg-primary)] hover:bg-[color-mix(in_srgb,var(--success)_80%,white)]"
            onClick={onApprove}
            type="button"
          >
            <Icon name="pass-filled" size="sm" />
            Approve & Execute
          </button>
          <button
            className="inline-flex items-center gap-1 px-3 py-1 border border-border rounded-md text-[11px] cursor-pointer transition-colors duration-150 bg-transparent text-fg-muted hover:bg-error hover:text-user-fg hover:border-error"
            onClick={onReject}
            type="button"
          >
            <Icon name="circle-slash" size="sm" />
            Reject
          </button>
        </div>
      )}

      {plan.status === "executing" && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <button
            className="inline-flex items-center gap-1 px-3 py-1 border border-border rounded-md text-[11px] cursor-pointer transition-colors duration-150 bg-transparent text-fg-muted hover:bg-error hover:text-user-fg hover:border-error"
            onClick={onCancel}
            type="button"
          >
            <Icon name="circle-slash" size="sm" />
            Cancel Execution
          </button>
        </div>
      )}

      {(plan.status === "completed" || plan.status === "failed") &&
        failedSteps.length > 0 &&
        onReplan && (
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <button
              className="inline-flex items-center gap-1 px-3 py-1 border border-accent rounded-md text-[11px] cursor-pointer transition-colors duration-150 bg-transparent text-accent hover:bg-accent hover:text-user-fg"
              onClick={() =>
                onReplan(
                  failedSteps[0].id,
                  failedSteps[0].error ?? "Step failed"
                )
              }
              type="button"
            >
              <Icon name="sync" size="sm" />
              Replan Failed Steps
            </button>
          </div>
        )}
    </div>
  );
}
