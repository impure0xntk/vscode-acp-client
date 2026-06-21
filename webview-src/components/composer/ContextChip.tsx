import React from "react";
import type { ContextAttachment } from "../../types";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
  contextColor?: "normal" | "warning" | "critical";
}

function getContextColors(
  color: "normal" | "warning" | "critical"
): { barFill: string; border: string; bg: string } {
  switch (color) {
    case "warning":
      return {
        barFill: "var(--warning)",
        border: "border-warning",
        bg: "bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]",
      };
    case "critical":
      return {
        barFill: "var(--error)",
        border: "border-error",
        bg: "bg-[color-mix(in_srgb,var(--error)_8%,transparent)]",
      };
    case "normal":
    default:
      return {
        barFill: "var(--success)",
        border: "border-border",
        bg: "bg-bg-secondary",
      };
  }
}

export function ContextChip({
  attachment,
  onRemove,
  contextColor = "normal",
}: ContextChipProps): React.ReactElement {
  const c = getContextColors(contextColor);

  return (
    <span
      className={`inline-flex items-center gap-0.75 px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap shrink-0 ${c.bg} ${c.border}${contextColor === "critical" ? " animate-context-pulse" : ""}`}
      title={`${attachment.path}\n${attachment.tokenCount} tokens`}
    >
      <span
        className="inline-flex flex-col-reverse w-0.75 h-3.5 rounded-[1.5px] overflow-hidden shrink-0"
        style={{ background: "color-mix(in srgb, var(--fg-muted) 15%, transparent)" }}
      >
        <span
          className="w-full rounded-[1.5px] transition-[height] duration-500"
          style={{ height: "100%", backgroundColor: c.barFill }}
        />
      </span>
      <span className="text-fg-primary max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
        {attachment.label}
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
