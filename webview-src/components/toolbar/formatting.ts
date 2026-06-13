import type { ToolbarMeta } from "../ui/Chip";

// ── Formatting helpers ──────────────────────────────────────────────────────

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtCaps(caps: string[]): string {
  if (caps.length <= 3) return caps.join(", ");
  return `${caps.slice(0, 3).join(", ")}, +${caps.length - 3} more`;
}

export function visualBar(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export function contextColor(ratio: number): string {
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.7) return "warning";
  return "normal";
}

// ── Statusline helpers ──────────────────────────────────────────────────────

export interface StatuslineInfo {
  hostname?: string;
  repoName?: string;
  branch?: string;
  tag?: string;
}

export function statuslinePrefix(s: StatuslineInfo): string | null {
  const has = s.hostname || s.repoName || s.branch || s.tag;
  if (!has) return null;
  return [s.hostname, s.repoName].filter(Boolean).join("  ") || null;
}

export function statuslineChips(s: StatuslineInfo): ToolbarMeta[] {
  const chips: ToolbarMeta[] = [];
  if (s.branch) chips.push({ key: "branch", label: "Branch", value: s.branch, category: "workspace" });
  if (s.tag) chips.push({ key: "tag", label: "Tag", value: s.tag, category: "workspace" });
  return chips;
}
