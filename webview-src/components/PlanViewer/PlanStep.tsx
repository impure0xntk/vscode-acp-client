import React, { useState, useCallback } from "react";
import type { PlanStep as PlanStepType } from "../../types";
import { Icon } from "../../lib/icons";

interface PlanStepProps {
  step: PlanStepType;
  index: number;
  canModify: boolean;
  onModify: (newDescription: string) => void;
  onRemove?: () => void;
  onStartAddAfter?: () => void;
  onReplan?: () => void;
}

const STATUS_ICON: Record<PlanStepType["status"], string> = {
  pending: "circle-outline",
  assigned: "circle-outline",
  in_progress: "loading",
  completed: "pass-filled",
  failed: "circle-filled",
  skipped: "circle-slash",
};

const STATUS_COLOR: Record<PlanStepType["status"], string> = {
  pending: "#666666",
  assigned: "#4fc3f7",
  in_progress: "#4fc3f7",
  completed: "#4ec9b0",
  failed: "#f14c4c",
  skipped: "#666666",
};

export function PlanStepView({
  step,
  index,
  canModify,
  onModify,
  onRemove,
  onStartAddAfter,
  onReplan,
}: PlanStepProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(step.description);

  const handleStartEdit = useCallback(() => {
    setEditText(step.description);
    setEditing(true);
  }, [step.description]);

  const handleCommitEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== step.description) {
      onModify(trimmed);
    }
    setEditing(false);
  }, [editText, step.description, onModify]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditText(step.description);
  }, [step.description]);

  return (
    <div className={`plan-step plan-step--${step.status}`}>
      <div className="plan-step-header">
        <Icon
          name={STATUS_ICON[step.status]}
          size="sm"
          style={{ color: STATUS_COLOR[step.status] }}
        />
        <span className="plan-step-index">{index + 1}.</span>

        {editing ? (
          <div className="plan-step-edit-inline">
            <input
              className="plan-step-edit-input"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitEdit();
                if (e.key === "Escape") handleCancelEdit();
              }}
            />
            <button className="plan-step-edit-confirm" onClick={handleCommitEdit} type="button">
              <Icon name="check" size="sm" />
            </button>
            <button className="plan-step-edit-cancel" onClick={handleCancelEdit} type="button">
              <Icon name="close" size="sm" />
            </button>
          </div>
        ) : (
          <span className="plan-step-description">{step.description}</span>
        )}
      </div>

      {step.assignedTo && (
        <div className="plan-step-assignee">
          <Icon name="person" size="sm" />
          <span>{step.assignedTo.agentId}</span>
        </div>
      )}

      {step.toolCall && (
        <div className="plan-step-tool">
          <Icon name="tools" size="sm" />
          <span>{step.toolCall.title}</span>
        </div>
      )}

      {step.error && (
        <div className="plan-step-error">
          <Icon name="circle-filled" size="sm" />
          <span>{step.error}</span>
        </div>
      )}

      {step.result && step.status === "completed" && (
        <div className="plan-step-result">
          <Icon name="pass-filled" size="sm" />
          <span>{step.result}</span>
        </div>
      )}

      {canModify && !editing && (
        <div className="plan-step-actions">
          <button className="plan-step-modify" onClick={handleStartEdit} type="button">
            <Icon name="pencil" size="sm" />
            Modify
          </button>
          {onStartAddAfter && (
            <button className="plan-step-add-after" onClick={onStartAddAfter} type="button">
              <Icon name="plus" size="sm" />
              Add after
            </button>
          )}
          {onRemove && (
            <button className="plan-step-remove" onClick={onRemove} type="button">
              <Icon name="trash" size="sm" />
              Remove
            </button>
          )}
        </div>
      )}

      {step.status === "failed" && onReplan && (
        <div className="plan-step-actions">
          <button className="plan-step-replan" onClick={onReplan} type="button">
            <Icon name="sync" size="sm" />
            Replan
          </button>
        </div>
      )}
    </div>
  );
}
