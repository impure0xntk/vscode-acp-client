import React, { useCallback } from "react";
import type { Plan } from "../../types";
import { PlanStepView } from "./PlanStep";
import { Icon } from "../../lib/icons";
import { getVsCodeApi } from "../../lib/vscodeApi";

export interface PlanViewerProps {
  plan: Plan | null;
  onApprove: () => void;
  onReject: () => void;
  onModifyStep: (stepIndex: number, modification: string) => void;
}

export function PlanViewer({ plan, onApprove, onReject, onModifyStep }: PlanViewerProps): React.ReactElement | null {
  const handleModifyStep = useCallback(
    (stepIndex: number) => (modification: string) => {
      onModifyStep(stepIndex, modification);
    },
    [onModifyStep]
  );

  if (!plan) return null;

  const allCompleted = plan.steps.every((s) => s.status === "completed");
  const hasFailed = plan.steps.some((s) => s.status === "failed");
  const statusLabel = allCompleted
    ? "All steps completed"
    : hasFailed
      ? "Some steps failed"
      : plan.status === "approved"
        ? "Approved — executing..."
        : plan.status === "rejected"
          ? "Rejected"
          : "Pending approval";

  return (
    <div className="plan-viewer">
      <div className="plan-viewer-header">
        <div className="plan-viewer-title">
          <Icon name="list-tree" size="sm" />
          <span>Execution Plan</span>
        </div>
        <span className={`plan-viewer-status plan-viewer-status--${plan.status}`}>
          {statusLabel}
        </span>
      </div>

      <div className="plan-viewer-steps">
        {plan.steps.map((step, idx) => (
          <PlanStepView
            key={step.id}
            step={step}
            index={idx}
            onModify={plan.status === "pending" ? handleModifyStep(idx) : undefined}
          />
        ))}
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

      {plan.status === "approved" && (
        <div className="plan-viewer-progress">
          <Icon name="loading" size="sm" />
          <span>Executing plan...</span>
        </div>
      )}
    </div>
  );
}
