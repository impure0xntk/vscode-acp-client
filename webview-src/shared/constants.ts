// ============================================================================
// Shared constants for elapsed-time color thresholds
// ============================================================================

/** Thresholds for color transitions (ms) */
export const ELAPSED_WARNING_MS = 10_000; // 10s → yellow
export const ELAPSED_CRITICAL_MS = 30_000; // 30s → red

// ============================================================================
// Session color palette — visually distinct colors for per-session identification
// ============================================================================

export const SESSION_COLOR_PALETTE: string[] = [
  "#E06C75", // red
  "#98C379", // green
  "#61AFEF", // blue
  "#C678DD", // purple
  "#E5C07B", // yellow
  "#56B6C2", // cyan
  "#D19A66", // orange
  "#F7ECB5", // light yellow
  "#7EC699", // mint
  "#E07C75", // salmon
  "#67CDCC", // teal
  "#F08D49", // deep orange
  "#AB7DF2", // lavender
  "#57B6F0", // sky blue
  "#E86A62", // coral
  "#8BD8A3", // sage
];
