import React from "react";

/**
 * Inline SVG icon components.
 * Each renders a 16×16 viewBox SVG that inherits color via currentColor.
 * No external font or asset dependency — pure React elements.
 */

interface IconProps {
  className?: string;
  size?: number;
  strokeWidth?: number;
  fill?: string;
}

// ── Primitive SVG wrapper ───────────────────────────────────────────────────

function Svg({
  children,
  className,
  size = 16,
  strokeWidth = 1.5,
}: IconProps & { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

// ── Status icons ────────────────────────────────────────────────────────────

export function IconCircleFilled({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

export function IconCircleOutline({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

export function IconCheck({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M3.5 8.5l3 3 7-7" />
    </Svg>
  );
}

export function IconCross({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconBan({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4 4l8 8" />
    </Svg>
  );
}

export function IconWarning({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M8 2.5l6 11H2L8 2.5z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
    </Svg>
  );
}

export function IconSpinner({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  );
}

// ── Action icons ────────────────────────────────────────────────────────────

export function IconClose({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconCopy({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <rect x="4" y="4" width="9" height="9" rx="1.5" />
      <path d="M12 4H3v9" />
    </Svg>
  );
}

export function IconZap({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M9 1L2 9h6l-1 6 7-8h-6l1-6z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSparkle({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M8 1l1.5 5L14 8l-4.5 2L8 15l-1.5-5L2 8l4.5-2L8 1z" />
    </svg>
  );
}

export function IconSync({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M2 8a6 6 0 0 1 10.5-4" />
      <path d="M14 8a6 6 0 0 1-10.5 4" />
      <path d="M12 1v3h-3" />
      <path d="M4 15v-3h3" />
    </Svg>
  );
}

// ── File type icons ─────────────────────────────────────────────────────────

export function IconFile({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M3 1.5h6l3.5 3.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" />
      <path d="M9.5 1.5V4a1 1 0 0 0 1 1h3.5" />
    </Svg>
  );
}

export function IconSelection({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M5 7h6M5 9h4" />
    </Svg>
  );
}

export function IconSymbolClass({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size} strokeWidth={0} fill="currentColor">
      <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4L8 1z" />
    </Svg>
  );
}

export function IconDiff({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M3 2h5l3 3v8H3z" />
      <path d="M6 2v3h3" />
      <path d="M6 8v3" />
      <circle cx="6" cy="6.5" r="0.8" fill="currentColor" />
      <circle cx="6" cy="12.5" r="0.8" fill="currentColor" />
    </Svg>
  );
}

export function IconTerminal({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4 7l2.5 2-2.5 2" />
      <path d="M8 11h4" />
    </Svg>
  );
}

export function IconFolder({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M1.5 3.5v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H7.8L6.5 3.5H1.5z" />
      <path d="M8.5 8.5h3" />
    </Svg>
  );
}

export function IconGitBranch({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <circle cx="5" cy="4" r="2" />
      <circle cx="11" cy="4" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M5 6v2a4 4 0 0 0 4 4" />
      <path d="M11 6v2" />
    </Svg>
  );
}

// ── UI icons ────────────────────────────────────────────────────────────────

export function IconTools({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M10.5 1.5l3 3-6 6-3-3z" />
      <path d="M5 7l-3 6 6-3" />
      <circle cx="11" cy="5" r="0.5" fill="currentColor" />
    </Svg>
  );
}

export function IconQuestion({ className, size = 16, strokeWidth }: IconProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M8 1a5 5 0 0 0-3 9v2h6v-2A5 5 0 0 0 8 1z" />
      <rect x="6.5" y="12" width="3" height="2.5" rx="0.5" />
      <text x="8" y="9" textAnchor="middle" fontSize="6" fontWeight="bold">?</text>
    </svg>
  );
}

export function IconOutput({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M5 6h6M5 9h6M5 11h4" />
    </Svg>
  );
}

export function IconRepoForked({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <circle cx="4" cy="3" r="2" />
      <circle cx="12" cy="3" r="2" />
      <circle cx="8" cy="13" r="2" />
      <path d="M4 5v3a4 4 0 0 0 4 4" />
      <path d="M12 5v3a4 4 0 0 1-4 4" />
    </Svg>
  );
}

export function IconClock({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l3 2" />
    </Svg>
  );
}

export function IconChevronDown({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M3 5.5l5 5 5-5" />
    </Svg>
  );
}

export function IconChevronRight({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M5.5 3l5 5-5 5" />
    </Svg>
  );
}

/** List-tree icon — indent lines + horizontal tee, like a tree/list toggle */
export function IconListTree({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size} strokeWidth={1.5}>
      <path d="M2 3h5" />
      <path d="M4 6h5" />
      <path d="M2 9h5" />
      <path d="M4 12h5" />
    </Svg>
  );
}

export function IconBrain({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M4 3.5a3.5 3.5 0 0 1 7 0c1 .5 1.5 1.5 1.5 2.5s-.5 2-1 2.5c1 .5 1.5 1.5 1.5 3a3.5 3.5 0 0 1-7 0 3.5 3.5 0 0 0 0-5 3 3 0 0 0-1.5-2.5c.5-.5.5-1 0-1z" />
      <path d="M6.5 7v2M9.5 7v2" />
      <path d="M6.5 5.5c1 0 1.5.5 1.5.5M9.5 5.5c-1 0-1.5.5-1.5.5" strokeWidth="0.8" />
    </Svg>
  );
}

export function IconScroll({ className, size = 16 }: IconProps): React.ReactElement {
  return (
    <Svg className={className} size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3h2" />
      <path d="M3 8h10" />
      <path d="M5 11l3-3 3 3" />
    </Svg>
  );
}

// ── Lookup table: name → component ──────────────────────────────────────────

const ICON_COMPONENTS: Record<string, React.FC<IconProps>> = {
  "circle-filled": IconCircleFilled,
  "circle-outline": IconCircleOutline,
  "pass-filled":     IconCheck,
  "circle-slash":    IconBan,
  loading:           IconSpinner,
  clock:             IconClock,
  check:             IconCheck,
  close:             IconClose,
  copy:              IconCopy,
  zap:               IconZap,
  sparkle:           IconSparkle,
  sync:              IconSync,
  file:              IconFile,
  selection:         IconSelection,
  "symbol-class":    IconSymbolClass,
  "diff-single":     IconDiff,
  terminal:          IconTerminal,
  "folder-opened":   IconFolder,
  "git-branch":      IconGitBranch,
  tools:             IconTools,
  question:          IconQuestion,
  output:            IconOutput,
  "repo-forked":     IconRepoForked,
  "chevron-down":    IconChevronDown,
  "chevron-right":   IconChevronRight,
  "list-tree":       IconListTree,
};

export function Icon({
  name,
  className,
  size,
  ...props
}: {
  name: string;
  className?: string;
  size?: "sm" | "md";
} & React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  const Cmp = ICON_COMPONENTS[name] ?? IconQuestion;
  const px = size === "sm" ? 12 : size === "md" ? 18 : 16;
  return <Cmp className={className} size={px} {...props} />;
}

/**
 * Map attachment/context types to icon names.
 */
export function iconForType(
  type: "file" | "selection" | "symbol" | "diff" | "terminal" | "folder" | "git"
): string {
  switch (type) {
    case "file":       return "file";
    case "selection":  return "selection";
    case "symbol":     return "symbol-class";
    case "diff":       return "diff-single";
    case "terminal":   return "terminal";
    case "folder":     return "folder-opened";
    case "git":        return "git-branch";
  }
}
