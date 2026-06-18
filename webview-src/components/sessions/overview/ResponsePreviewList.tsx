import React from "react";
import type { ResponsePreview } from "../../../types";
import { Icon } from "../../../lib/icons"

interface Props {
  responses: ResponsePreview[];
  maxItems?: number;
}

const STATUS_ICON: Record<string, string> = {
  completed: "pass-filled",
  loading: "loading",
  failed: "error",
};

export function ResponsePreviewList({
  responses,
  maxItems = 3,
}: Props): React.ReactElement | null {
  if (responses.length === 0) return null;

  const items = responses.slice(-maxItems);

  return (
    <div className="response-preview-list">
      {items.map((r) => (
        <div
          key={r.messageId}
          className={`response-preview-item response-preview-item--${r.role}`}
        >
          {r.status && (
            <Icon
              name={STATUS_ICON[r.status] ?? "loading"}
              className="response-preview-status"
              size="sm"
            />
          )}
          <span className="response-preview-text" title={r.preview}>
            {r.preview}
          </span>
        </div>
      ))}
    </div>
  );
}
