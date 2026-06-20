import React from "react";
import type { ContextAttachment } from "../../types";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
  contextColor?: "normal" | "warning" | "critical";
}

function getContextColors(
  color: "normal" | "warning" | "critical"
): { barBg: string; barFill: string; border: string; bg: string } {
  switch (color) {
    case "warning":
      return {
        barBg: "var(--warning)",
        barFill: "var(--warning)",
        border: "border-[var(--warning)]",
        bg: "bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]",
      };
    case "critical":
      return {
        barBg: "var(--error)",
        barFill: "var(--error)",
        border: "border-[var(--error)]",
        bg: "bg-[color-mix(in_srgb,var(--error)_8%,transparent)]",
      };
    case "normal":
    default:
      return {
        barBg: "var(--success)",
        barFill: "var(--success)",
        border: "border-[var(--border)]",
        bg: "bg-[var(--bg-secondary)]",
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
      className={`inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] border text-[11px] whitespace-nowrap shrink-0 ${c.bg} ${c.border}`}
      title={`${attachment.path}\n${attachment.tokenCount} tokens`}
    >
      {/* Context usage bar */}
      <span
        className="inline-flex flex-col-reverse w-[3px] h-[14px] rounded-[1.5px] overflow-hidden shrink-0"
        style={{
          background: `color-mix(in srgb, var(--fg-muted) 15%, transparent)`,
        }}
      >
        <span
          className="w-full rounded-[1.5px] transition-[height] duration-500"
          style={{
            height: "100%",
            backgroundColor: c.barFill,
          }}
        />
      </span>
      <span className="text-[var(--fg-primary)] max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
        {attachment.label}
      </span>
      <span className="text-[var(--fg-muted)] text-[9px]">
        {attachment.tokenCount}
      </span>
      <button
        className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 border-none rounded-[2px] bg-transparent text-[var(--fg-muted)] text-[12px] leading-none cursor-pointer shrink-0 ml-[1px] hover:bg-[var(--error)] hover:text-[var(--user-fg)]"
        onClick={() => onRemove(attachment.id)}
        title="Remove"
      >
        ×
      </button>
    </span>
  );
}
