import React from "react";
import type { ResponsePreview } from "../../../types";
import { Icon } from "../../../lib/icons";

// ============================================================================
// Response Preview — compact inline list (card & popup)
// ============================================================================

const STATUS_ICON: Record<string, string> = {
  completed: "pass-filled",
  loading: "loading",
  failed: "error",
};

export function ResponsePreviewList({
  responses,
  maxItems = 5,
  className = "",
}: {
  responses: ResponsePreview[];
  maxItems?: number;
  className?: string;
}): React.ReactElement | null {
  if (responses.length === 0) return null;
  const items = responses.slice(-maxItems);

  return (
    <div className={`mt-1 flex flex-col gap-0.5 ${className}`.trim()}>
      {items.map((r) => (
        <div
          key={r.messageId}
          className={`flex items-start gap-1 px-1 py-0.5 rounded-sm text-[10px] leading-[1.4] response-preview-item--${r.role}`}
        >
          {r.status && (
            <Icon
              name={STATUS_ICON[r.status] ?? "loading"}
              className="shrink-0 text-[9px] w-[10px] text-center mt-px"
              size="sm"
            />
          )}
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={r.preview}>
            {r.preview}
          </span>
        </div>
      ))}
    </div>
  );
}
