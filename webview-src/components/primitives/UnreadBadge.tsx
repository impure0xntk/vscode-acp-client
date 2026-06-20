import React from "react";

export interface UnreadBadgeProps {
  count: number;
  /** When true, suppress the badge (already visible / active) */
  hidden?: boolean;
  /** CSS class name for the badge element */
  className?: string;
}

/**
 * Unread message count badge.
 * Hidden when `hidden` is true or count is zero.
 * Caps display at "99+".
 */
export function UnreadBadge({
  count,
  hidden = false,
  className = "",
}: UnreadBadgeProps): React.ReactElement | null {
  if (count <= 0 || hidden) return null;
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-[4px] rounded-[8px] bg-[var(--accent)] text-[var(--user-fg)] text-[9px] font-bold leading-none shadow-[0_1px_3px_rgba(0,0,0,0.35)] pointer-events-none shrink-0 ${className}`.trim()}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
