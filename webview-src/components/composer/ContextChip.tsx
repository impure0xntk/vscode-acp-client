import React from "react";
import type { ContextAttachment } from "../../types";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { Icon, iconForType } from "../../lib/icons";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
  contextColor?: "normal" | "warning" | "critical";
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

/** Derive a concise display label per attachment type. */
function displayLabel(a: ContextAttachment): string {
  const name = a.path.split("/").pop() ?? a.path;
  switch (a.type) {
    case "selection":
      return a.lineRange ? `${name}:${a.lineRange[0]}-${a.lineRange[1]}` : name;
    case "symbol":
      return a.label;
    case "diff":
      return "diff";
    case "file":
    default:
      return name;
  }
}

export function ContextChip({
  attachment,
  onRemove,
  contextColor = "normal",
}: ContextChipProps): React.ReactElement {
  const c = getContextColors(contextColor);

  const handleClick = () => {
    const vscode = getVsCodeApi();
    vscode.postMessage({
      type: "openFile",
      path: attachment.path,
      line: attachment.lineRange?.[0],
    });
  };

  const label = displayLabel(attachment);
  const iconName = iconForType(attachment.type);

  return (
    <span
      className={`inline-flex items-center gap-[3px] px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap shrink-0 ${c.bg} ${c.border}${contextColor === "critical" ? " animate-context-pulse" : ""}`}
      title={`${attachment.path}\n${attachment.tokenCount} tokens`}
    >
      <Icon name={iconName} size="sm" className="text-[12px] shrink-0" />
      <span
        className="text-fg-primary max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer hover:underline"
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
