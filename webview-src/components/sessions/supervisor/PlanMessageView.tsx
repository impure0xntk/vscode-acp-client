import React, { useCallback } from "react";
import type { Plan } from "../../../types";
import {
  IconCheck,
  IconSpinner,
  IconCircleOutline,
  IconCross,
  IconBan,
  IconPencil,
} from "../../../lib/icons";

/** Map plan-step status to its SVG icon component. */
const STEP_ICON: Record<
  string,
  React.FC<{ size?: number; className?: string }>
> = {
  completed: IconCheck,
  in_progress: IconSpinner,
  pending: IconCircleOutline,
  failed: IconCross,
  skipped: IconBan,
};

interface Props {
  plan: Plan;
  isLatest: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onModifyStep?: (stepId: string, newDescription: string) => void;
}

export const PlanMessageView = React.memo(function PlanMessageView({
  plan,
  isLatest,
  onApprove,
  onReject,
  onModifyStep,
}: Props): React.ReactElement {
  const handleApprove = useCallback(() => {
    onApprove?.();
  }, [onApprove]);

  const handleReject = useCallback(() => {
    onReject?.();
  }, [onReject]);

  return (
    <div className="flex flex-col gap-1 p-2 my-1 rounded border border-border bg-bg-secondary">
      <div className="flex flex-col gap-0.5">
        {plan.steps.map((step) => {
          const StepIcon = STEP_ICON[step.status] ?? IconCircleOutline;
          const isModifiable = onModifyStep && step.status === "pending";

          return (
            <div
              key={step.id}
              className="flex items-start gap-2 text-[11px] group"
            >
              <StepIcon
                size={12}
                className={`shrink-0 mt-0.5 ${
                  step.status === "in_progress"
                    ? "animate-spin text-accent"
                    : step.status === "completed"
                      ? "text-fg-muted"
                      : step.status === "failed"
                        ? "text-error"
                        : "text-fg-secondary"
                }`}
              />
              <span
                className={`flex-1 leading-tight ${
                  step.status === "completed"
                    ? "text-fg-muted line-through"
                    : step.status === "failed"
                      ? "text-error"
                      : "text-fg-primary"
                }`}
              >
                {step.description}
              </span>
              {step.assignedTo && (
                <span className="shrink-0 text-[9px] text-fg-muted font-mono opacity-70">
                  {step.assignedTo.agentId}
                </span>
              )}
              {isModifiable && (
                <button
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-fg-muted hover:text-accent cursor-pointer transition-opacity"
                  onClick={() => onModifyStep(step.id, step.description)}
                  type="button"
                  title="Edit step"
                >
                  <IconPencil size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isLatest && plan.status === "pending" && (onApprove || onReject) && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
          {onApprove && (
            <button
              className="px-3 py-1 rounded border border-accent bg-accent text-user-fg text-[11px] hover:opacity-90 cursor-pointer transition-opacity"
              onClick={handleApprove}
              type="button"
            >
              Approve & Execute
            </button>
          )}
          {onReject && (
            <button
              className="px-3 py-1 rounded border border-border bg-bg-primary text-fg-secondary text-[11px] hover:bg-error hover:text-user-fg cursor-pointer transition-colors"
              onClick={handleReject}
              type="button"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
});
