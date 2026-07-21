import React from "react";
import type { ChatMessage } from "../../../types";

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "You",
  agent: "Agent",
  system: "System",
  tool: "Tool",
};

const ROLE_COLOR: Record<ChatMessage["role"], string> = {
  user: "text-accent",
  agent: "text-fg-secondary",
  system: "text-fg-muted",
  tool: "text-fg-muted",
};

const ROLE_BG: Record<ChatMessage["role"], string> = {
  user: "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]",
  agent: "bg-bg-tertiary",
  system: "bg-bg-tertiary",
  tool: "bg-bg-tertiary",
};

/**
 * Renders a compact list of the most recent messages in a session.
 * Shown on the right side of the SessionOverviewCard to give a quick
 * conversational preview without expanding the card.
 */
export function MessageHistoryPreview({
  messages,
  maxItems = 4,
  className = "",
}: {
  messages: ChatMessage[];
  maxItems?: number;
  className?: string;
}): React.ReactElement | null {
  if (messages.length === 0) return null;
  const items = messages.slice(-maxItems);

  return (
    <div
      className={`flex flex-col gap-0.5 mt-[4px] pt-1 border-t border-border/40 overflow-hidden ${className}`.trim()}
    >
      {items.map((m) => {
        const isUser = m.role === "user";
        const preview = m.content.replace(/\s+/g, " ").trim();
        const truncated =
          preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
        const label = ROLE_LABEL[m.role];
        return (
          <div
            key={m.id}
            className={`flex flex-col gap-[1px] p-[2px 4px] rounded-sm text-2xs leading-[1.35] ${ROLE_BG[m.role]}`}
          >
            <span
              className={`text-3xs font-[var(--font-ui)] uppercase tracking-wide ${ROLE_COLOR[m.role]}`}
            >
              {label}
            </span>
            <span
              className="text-2xs text-fg-secondary overflow-hidden whitespace-nowrap truncate"
              title={preview}
            >
              {truncated || "…"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
