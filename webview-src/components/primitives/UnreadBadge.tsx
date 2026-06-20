import React from "react";

export interface UnreadBadgeProps {
  count: number;
  hidden?: boolean;
  className?: string;
}

export function UnreadBadge({
  count,
  hidden = false,
  className = "",
}: UnreadBadgeProps): React.ReactElement | null {
  if (count <= 0 || hidden) return null;
  return (
    <span
      className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-lg bg-accent text-user-fg text-3xs font-bold leading-none shadow-badge pointer-events-none shrink-0 ${className}`.trim()}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
