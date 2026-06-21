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
    <div className={`flex flex-col gap-0.5 mt-[4px] pt-1 border-t border-border/40 ${className}`.trim()}>
      {items.map((r) => (
        <div
          key={r.messageId}
          className={`flex items-start gap-1 p-[2px 4px] text-2xs rounded-sm leading-[1.4] ${r.role === "agent" ? "text-fg-secondary" : "text-fg-muted"}`}
        >
          {r.status && (
            <Icon
              name={STATUS_ICON[r.status] ?? "loading"}
              className="shrink-0 mt-[1px] w-[10px] text-3xs text-center"
              size="sm"
            />
          )}
          <span className="flex-1 min-w-0 overflow-hidden whitespace-nowrap truncate" title={r.preview}>
            {r.preview}
          </span>
        </div>
      ))}
    </div>
  );
}
