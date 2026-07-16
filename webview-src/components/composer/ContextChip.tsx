import React from "react";
import type { ContextAttachment } from "../../types";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { Icon, iconForType } from "../../lib/icons";
import { attachmentLabel } from "../../lib/attachments";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
  contextColor?: "normal" | "warning" | "critical";
  /** Called when the chip body is clicked for preview (distinct from remove). */
  onPreview?: (attachment: ContextAttachment) => void;
  /** Whether this chip's attachment is currently being previewed. */
  isPreviewing?: boolean;
}

function getContextColors(color: "normal" | "warning" | "critical"): {
  border: string;
  bg: string;
} {
  switch (color) {
    case "warning":
      return {
        border: "border-warning",
        bg: "bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]",
      };
    case "critical":
      return {
        border: "border-error",
        bg: "bg-[color-mix(in_srgb,var(--error)_8%,transparent)]",
      };
    case "normal":
    default:
      return {
        border: "border-border",
        bg: "bg-bg-secondary",
      };
  }
}

export function ContextChip({
  attachment,
  onRemove,
  contextColor = "normal",
  onPreview,
  isPreviewing = false,
}: ContextChipProps): React.ReactElement {
  const c = getContextColors(contextColor);

  // Clicking the label previews the attachment when it adds context tokens;
  // clicking also opens the file in the editor (when a real path exists).
  // Clicking the chip label toggles the preview; a modifier-click (Cmd/Ctrl)
  // also opens the file in the editor. Plain click no longer forces a jump,
  // so users can inspect context without losing their place.
  const handleClick = (e: React.MouseEvent) => {
    if (onPreview) onPreview(attachment);
    if (e.metaKey || e.ctrlKey) {
      if (!attachment.path) return; // Turn attachments have no real path
      const vscode = getVsCodeApi();
      vscode.postMessage({
        type: "openFile",
        path: attachment.path,
        line: attachment.lineRange?.[0],
      });
    }
  };

  const label = attachmentLabel(attachment);
  const iconName = iconForType(attachment.type);

  return (
    <span
      className={`inline-flex items-center gap-[3px] px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap shrink-0 ${c.bg} ${c.border}${contextColor === "critical" ? " animate-context-pulse" : ""}${isPreviewing ? " ring-1 ring-accent" : ""}`}
      title={`${attachment.path}\n${attachment.tokenCount} tokens`}
    >
      <Icon name={iconName} size="sm" className="text-[12px] shrink-0" />
      <span
        className="text-fg-primary max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer hover:underline"
        title="Click to preview · Cmd/Ctrl+Click to open file"
        onClick={handleClick}
      >
        {label}
      </span>
      <span className="text-fg-muted text-3xs">{attachment.tokenCount}</span>
      <button
        className="inline-flex items-center justify-center w-3.5 h-3.5 p-0 border-none rounded-[2px] bg-transparent text-fg-muted text-[12px] leading-none cursor-pointer shrink-0 ml-0.5 hover:bg-error hover:text-user-fg"
        onClick={() => onRemove(attachment.id)}
        title="Remove"
      >
        ×
      </button>
    </span>
  );
}
