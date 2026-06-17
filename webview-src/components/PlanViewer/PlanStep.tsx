import React from "react";
import type { PlanStep as PlanStepType } from "../../types";
import { Icon } from "../../lib/icons";

interface PlanStepProps {
  step: PlanStepType;
  index: number;
  onModify?: (modification: string) => void;
}

const STATUS_ICON: Record<PlanStepType["status"], string> = {
  pending: "circle-outline",
  in_progress: "loading",
  completed: "pass-filled",
  failed: "circle-filled",
};

const STATUS_COLOR: Record<PlanStepType["status"], string> = {
  pending: "#666666",
  in_progress: "#4fc1ff",
  completed: "#4ec9b0",
  failed: "#f14c4c",
};

export function PlanStepView({ step, index, onModify }: PlanStepProps): React.ReactElement {
  return (
    <div className={`plan-step plan-step--${step.status}`}>
      <div className="plan-step-header">
        <Icon
          name={STATUS_ICON[step.status]}
          size="sm"
          style={{ color: STATUS_COLOR[step.status] }}
        />
        <span className="plan-step-index">{index + 1}.</span>
        <span className="plan-step-description">{step.description}</span>
      </div>
      {step.toolCall && (
        <div className="plan-step-tool">
          <Icon name="tools" size="sm" />
          <span>{step.toolCall.title}</span>
        </div>
      )}
      {onModify && step.status === "pending" && (
        <button
          className="plan-step-modify"
          onClick={() => onModify(step.description)}
          type="button"
        >
          <Icon name="pencil" size="sm" />
          Modify
        </button>
      )}
    </div>
  );
}
