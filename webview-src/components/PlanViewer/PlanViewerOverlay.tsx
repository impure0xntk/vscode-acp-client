import React, { useCallback } from "react";
import type { Plan } from "../../types";
import { PlanViewer } from "./PlanViewer";
import { getVsCodeApi } from "../../lib/vscodeApi";

interface PlanViewerOverlayProps {
  plan: Plan;
}

export function PlanViewerOverlay({ plan }: PlanViewerOverlayProps): React.ReactElement {
  const handleApprove = useCallback(() => {
    getVsCodeApi().postMessage({ type: "plan.approve", planId: plan.id });
  }, [plan.id]);

  const handleReject = useCallback(() => {
    getVsCodeApi().postMessage({ type: "plan.reject", planId: plan.id });
  }, [plan.id]);

  const handleModifyStep = useCallback(
    (stepId: string, newDescription: string) => {
      getVsCodeApi().postMessage({
        type: "plan.modifyStep",
        planId: plan.id,
        stepId,
        newDescription,
      });
    },
    [plan.id]
  );

  const handleAddStep = useCallback(
    (description: string, afterStepId?: string) => {
      getVsCodeApi().postMessage({
        type: "plan.addStep",
        planId: plan.id,
        description,
        afterStepId,
      });
    },
    [plan.id]
  );

  const handleRemoveStep = useCallback(
    (stepId: string) => {
      getVsCodeApi().postMessage({
        type: "plan.removeStep",
        planId: plan.id,
        stepId,
      });
    },
    [plan.id]
  );

  const handleCancel = useCallback(() => {
    getVsCodeApi().postMessage({ type: "plan.cancel", planId: plan.id });
  }, [plan.id]);

  const handleReplan = useCallback(
    (failedStepId: string, reason: string) => {
      getVsCodeApi().postMessage({
        type: "plan.replan",
        planId: plan.id,
        failedStepId,
        reason,
      });
    },
    [plan.id]
  );

  return (
    <div className="plan-viewer-overlay">
      <PlanViewer
        plan={plan}
        onApprove={handleApprove}
        onReject={handleReject}
        onModifyStep={handleModifyStep}
        onAddStep={handleAddStep}
        onRemoveStep={handleRemoveStep}
        onCancel={handleCancel}
        onReplan={plan.status === "failed" ? handleReplan : undefined}
      />
    </div>
  );
}
