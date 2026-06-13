import React from "react";

interface UnreadBadgeProps {
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
    <span className={className}>{count > 99 ? "99+" : count}</span>
  );
}
