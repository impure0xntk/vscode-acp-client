import { ELAPSED_WARNING_MS, ELAPSED_CRITICAL_MS } from "./constants";

export type ElapsedColor = "normal" | "warning" | "critical";

export function elapsedColor(elapsedMs: number): ElapsedColor {
  if (elapsedMs >= ELAPSED_CRITICAL_MS) return "critical";
  if (elapsedMs >= ELAPSED_WARNING_MS) return "warning";
  return "normal";
}

const colorMap: Record<ElapsedColor, string> = {
  normal: "var(--fg-primary)",
  warning: "var(--warning)",
  critical: "var(--error)",
};

export function elapsedColorValue(elapsedMs: number): string {
  return colorMap[elapsedColor(elapsedMs)];
}
