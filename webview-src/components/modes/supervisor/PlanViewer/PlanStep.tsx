import React, { useState, useCallback } from "react";
import type { PlanStep as PlanStepType } from "../../../../types";
import { Icon } from "../../../../lib/icons";

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
    <div
      className={`flex flex-col gap-1 px-2 py-1 rounded-[3px] bg-bg-primary border-l-2${step.status === "pending" ? " border-l-[var(--fg-muted)]" : step.status === "assigned" ? " border-l-[var(--accent)]" : step.status === "in_progress" ? " border-l-[#4fc3f7]" : step.status === "completed" ? " border-l-[var(--success)]" : step.status === "failed" ? " border-l-[var(--error)]" : step.status === "skipped" ? " border-l-[var(--fg-muted)] opacity-50" : " border-l-transparent"}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          name={STATUS_ICON[step.status]}
          size="sm"
          style={{ color: STATUS_COLOR[step.status] }}
        />
        <span className="text-[10px] text-fg-muted font-mono flex-shrink-0 w-5">
          {index + 1}.
        </span>

        {editing ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              className="flex-1 px-1.5 py-0.5 border border-accent rounded-[3px] bg-bg-input text-fg-primary text-[11px] outline-none"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitEdit();
                if (e.key === "Escape") handleCancelEdit();
              }}
            />
            <button
              className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-success hover:text-user-fg"
              onClick={handleCommitEdit}
              type="button"
            >
              <Icon name="check" size="sm" />
            </button>
            <button
              className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-error hover:text-user-fg"
              onClick={handleCancelEdit}
              type="button"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        ) : (
          <span className="flex-1 text-[11px] text-fg-primary">
            {step.description}
          </span>
        )}
      </div>

      {step.assignedTo && (
        <div className="flex items-center gap-1 text-[10px] text-fg-muted pl-6">
          <Icon name="person" size="sm" />
          <span>{step.assignedTo.agentId}</span>
        </div>
      )}

      {step.toolCall && (
        <div className="flex items-center gap-1 text-[10px] text-fg-muted pl-6">
          <Icon name="tools" size="sm" />
          <span>{step.toolCall.title}</span>
        </div>
      )}

      {step.error && (
        <div className="flex items-center gap-1 text-[10px] text-error pl-6">
          <Icon name="circle-filled" size="sm" />
          <span>{step.error}</span>
        </div>
      )}

      {step.result && step.status === "completed" && (
        <div className="flex items-center gap-1 text-[10px] text-[var(--success)] pl-6">
          <Icon name="pass-filled" size="sm" />
          <span>{step.result}</span>
        </div>
      )}

      {canModify && !editing && (
        <div className="flex items-center gap-1 pl-6">
          <button
            className="inline-flex items-center gap-[3px] px-1.5 py-px border border-border rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer transition-colors duration-150 hover:bg-accent-hover hover:text-fg-primary"
            onClick={handleStartEdit}
            type="button"
          >
            <Icon name="pencil" size="sm" />
            Modify
          </button>
          {onStartAddAfter && (
            <button
              className="inline-flex items-center gap-[3px] px-1.5 py-px border border-border rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer transition-colors duration-150 hover:bg-accent-hover hover:text-fg-primary"
              onClick={onStartAddAfter}
              type="button"
            >
              <Icon name="plus" size="sm" />
              Add after
            </button>
          )}
          {onRemove && (
            <button
              className="inline-flex items-center gap-[3px] px-1.5 py-px border border-border rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer transition-colors duration-150 hover:bg-error hover:text-user-fg"
              onClick={onRemove}
              type="button"
            >
              <Icon name="trash" size="sm" />
              Remove
            </button>
          )}
        </div>
      )}

      {step.status === "failed" && onReplan && (
        <div className="flex items-center gap-1 pl-6">
          <button
            className="inline-flex items-center gap-[3px] px-1.5 py-px border border-border rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer transition-colors duration-150 hover:bg-accent-hover hover:text-fg-primary"
            onClick={onReplan}
            type="button"
          >
            <Icon name="sync" size="sm" />
            Replan
          </button>
        </div>
      )}
    </div>
  );
}
