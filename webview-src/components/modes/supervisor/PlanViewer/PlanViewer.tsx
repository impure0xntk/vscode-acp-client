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
    <div className="plan-viewer">
      <div className="plan-viewer-header">
        <div className="plan-viewer-title">
          <Icon name="list-tree" size="sm" />
          <span>Execution Plan</span>
        </div>
        <div className="plan-viewer-header-right">
          <span
            className={`plan-viewer-status plan-viewer-status--${plan.status}`}
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
            className="plan-viewer-close"
            onClick={onClose}
            type="button"
            aria-label="Close plan"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      </div>

      {(plan.status === "executing" || plan.status === "approved") && (
        <div className="plan-viewer-progress-bar">
          <div className="plan-viewer-progress-track">
            <div
              className="plan-viewer-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="plan-viewer-progress-text">
            {completedCount}/{totalSteps} steps
          </span>
        </div>
      )}

      <div className="plan-viewer-steps">
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
              <div className="plan-step-add-form">
                <input
                  className="plan-step-add-input"
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
                  className="plan-step-add-confirm"
                  onClick={handleCommitAdd}
                  type="button"
                >
                  <Icon name="check" size="sm" />
                </button>
                <button
                  className="plan-step-add-cancel"
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
              <div className="plan-step-add-form">
                <input
                  className="plan-step-add-input"
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
                  className="plan-step-add-confirm"
                  onClick={handleCommitAdd}
                  type="button"
                >
                  <Icon name="check" size="sm" />
                </button>
                <button
                  className="plan-step-add-cancel"
                  onClick={handleCancelAdd}
                  type="button"
                >
                  <Icon name="close" size="sm" />
                </button>
              </div>
            ) : (
              <button
                className="plan-step-add-trigger"
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
        <div className="plan-viewer-actions">
          <button
            className="plan-viewer-approve"
            onClick={onApprove}
            type="button"
          >
            <Icon name="pass-filled" size="sm" />
            Approve & Execute
          </button>
          <button
            className="plan-viewer-reject"
            onClick={onReject}
            type="button"
          >
            <Icon name="circle-slash" size="sm" />
            Reject
          </button>
        </div>
      )}

      {plan.status === "executing" && (
        <div className="plan-viewer-actions">
          <button
            className="plan-viewer-cancel"
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
          <div className="plan-viewer-actions">
            <button
              className="plan-viewer-replan"
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
