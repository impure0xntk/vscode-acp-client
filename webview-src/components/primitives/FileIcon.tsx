import React from "react";

// ── Shared helpers ─────────────────────────────────────────────────────────

export function getFileExtension(path: string): string {
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? path;
  const dotIdx = filename.lastIndexOf(".");
  return dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : "";
}

const EXT_ICON: Record<string, string> = {
  ts: "TS",
  tsx: "TS",
  js: "TS",
  jsx: "TS",
  py: "PY",
  rs: "RS",
  go: "GO",
  java: "JV",
  c: "C",
  cpp: "C",
  h: "C",
  hpp: "C",
  md: "MD",
  json: "{}",
  yaml: "Y",
  yml: "Y",
  toml: "T",
  nix: "N",
};

export function fileIcon(ext: string): string {
  return EXT_ICON[ext] ?? "•";
}

// ── Component ──────────────────────────────────────────────────────────────

export interface FileIconProps {
  path: string;
  className?: string;
}

/**
 * Compact file-type badge — monospace label derived from extension.
 * Shared across FileEditSummary, context chips, and any file-list UI.
 */
export function FileIcon({ path, className = "" }: FileIconProps): React.ReactElement {
  const ext = getFileExtension(path);
  return (
    <span
      className={`inline-flex items-center justify-center w-[18px] h-[13px] rounded-[2px] font-mono text-[8px] font-bold leading-none bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-fg-secondary flex-shrink-0 ${className}`.trim()}
      aria-hidden="true"
    >
      {fileIcon(ext)}
    </span>
  );
}
