import React, { useCallback } from "react";
import type { Plan } from "../../../types";
import { StatusIcon } from "../../primitives/StatusIcon";
import { IconClipboardList, IconCheck, IconCross } from "../../../lib/icons";

interface Props {
  plan: Plan | null;
  isPlanning: boolean;
  planningProgress?: number;
  onViewPlan: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

function currentStepLabel(plan: Plan): string {
  const inProgress = plan.steps.find((s) => s.status === "in_progress");
  if (inProgress) return `Step ${inProgress.index + 1}/${plan.steps.length}`;
  const completed = plan.steps.filter((s) => s.status === "completed").length;
  return `Step ${completed}/${plan.steps.length}`;
}

function progressPct(plan: Plan): number {
  if (plan.steps.length === 0) return 0;
  const completed = plan.steps.filter((s) => s.status === "completed").length;
  return Math.round((completed / plan.steps.length) * 100);
}

export const PlanCompactBar = React.memo(function PlanCompactBar({
  plan,
  isPlanning,
  planningProgress,
  onViewPlan,
  onApprove,
  onReject,
}: Props): React.ReactElement | null {
  if (!plan && isPlanning) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border text-[11px]">
        <StatusIcon status="running" size="sm" />
        <span className="text-fg-secondary">Planning...</span>
        {planningProgress != null && planningProgress > 0 && (
          <div className="flex-1 h-1 bg-bg-primary rounded overflow-hidden max-w-[120px]">
            <div
              className="h-full bg-accent rounded transition-all duration-300"
              style={{ width: `${Math.min(100, planningProgress)}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (!plan) return null;

  const handleViewPlan = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onViewPlan();
    },
    [onViewPlan]
  );

  if (plan.status === "pending") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border text-[11px]">
        <IconClipboardList size={14} className="text-fg-secondary" />
        <span className="text-fg-secondary font-medium">
          Plan ({plan.steps.length} steps)
        </span>
        <div className="flex-1" />
        {onApprove && (
          <button
            className="px-2 py-0.5 rounded border border-accent bg-accent text-user-fg hover:opacity-90 cursor-pointer transition-opacity"
            onClick={onApprove}
            type="button"
          >
            Approve
          </button>
        )}
        {onReject && (
          <button
            className="px-2 py-0.5 rounded border border-border bg-bg-primary text-fg-secondary hover:bg-error hover:text-user-fg cursor-pointer transition-colors"
            onClick={onReject}
            type="button"
          >
            Reject
          </button>
        )}
        <button
          className="px-2 py-0.5 rounded border border-border bg-bg-primary text-fg-secondary hover:bg-accent-hover cursor-pointer transition-colors"
          onClick={handleViewPlan}
          type="button"
        >
          Details
        </button>
      </div>
    );
  }

  if (plan.status === "executing") {
    const pct = progressPct(plan);
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border text-[11px]">
        <StatusIcon status="running" size="sm" />
        <IconClipboardList size={14} className="text-fg-secondary" />
        <span className="text-fg-secondary font-medium">
          {currentStepLabel(plan)}
        </span>
        <div className="flex-1 h-1 bg-bg-primary rounded overflow-hidden max-w-[120px]">
          <div
            className="h-full bg-accent rounded transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-fg-muted font-mono">{pct}%</span>
        <button
          className="px-2 py-0.5 rounded border border-border bg-bg-primary text-fg-secondary hover:bg-accent-hover cursor-pointer transition-colors"
          onClick={handleViewPlan}
          type="button"
        >
          Details
        </button>
      </div>
    );
  }

  if (plan.status === "completed") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border text-[11px]">
        <IconCheck size={14} className="text-fg-secondary" />
        <span className="text-fg-secondary">
          Plan completed ({plan.steps.length} steps)
        </span>
        <div className="flex-1" />
        <button
          className="px-2 py-0.5 rounded border border-border bg-bg-primary text-fg-secondary hover:bg-accent-hover cursor-pointer transition-colors"
          onClick={handleViewPlan}
          type="button"
        >
          View
        </button>
      </div>
    );
  }

  if (plan.status === "failed") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border text-[11px]">
        <IconCross size={14} className="text-error" />
        <span className="text-error">
          Plan failed ({currentStepLabel(plan)})
        </span>
        <div className="flex-1" />
        <button
          className="px-2 py-0.5 rounded border border-border bg-bg-primary text-fg-secondary hover:bg-accent-hover cursor-pointer transition-colors"
          onClick={handleViewPlan}
          type="button"
        >
          View
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border text-[11px]">
      <StatusIcon status="cancelled" size="sm" />
      <span className="text-fg-muted">Plan {plan.status}</span>
      <div className="flex-1" />
      <button
        className="px-2 py-0.5 rounded border border-border bg-bg-primary text-fg-secondary hover:bg-accent-hover cursor-pointer transition-colors"
        onClick={handleViewPlan}
        type="button"
      >
        View
      </button>
    </div>
  );
});
