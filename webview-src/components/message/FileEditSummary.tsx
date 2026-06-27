import React, { useCallback } from "react";
import type { FileEditEntry } from "../../pipeline/types";
import { fileIcon, getFileExtension } from "./ToolCallCard";
import { getVsCodeApi } from "../../lib/vscodeApi";

export interface FileEditSummaryProps {
  entries: FileEditEntry[];
}

export function FileEditSummary({ entries }: FileEditSummaryProps): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <div className="ml-4 mr-1 mt-[2px] mb-[2px] px-1.25 py-[3px] rounded bg-[color-mix(in_srgb,var(--bg-secondary)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_15%,transparent)]">
      <div className="flex items-center gap-1 mb-[2px]">
        <span className="text-[9px] font-semibold uppercase text-fg-muted tracking-wide">Files edited</span>
        <span className="text-[9px] font-mono text-fg-muted">{entries.length}</span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {entries.map((entry, idx) => (
          <FileEditChip key={`${entry.path}-${idx}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function FileEditChip({ entry }: { entry: FileEditEntry }): React.ReactElement {
  const ext = getFileExtension(entry.path);
  const basename = entry.path.split("/").pop() ?? entry.path;

  const handleClick = useCallback(() => {
    try {
      getVsCodeApi().postMessage({ type: "openFile", path: entry.path });
    } catch { /* vscodeApi not available */ }
  }, [entry.path]);

  return (
    <span
      className="inline-flex items-center gap-0.5 px-[3px] py-px rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[9px] cursor-pointer select-none transition-colors duration-150 hover:bg-accent-hover"
      onClick={handleClick}
      title={entry.path}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") handleClick(); }}
    >
      <span className="inline-flex items-center justify-center w-[13px] h-[10px] rounded-[2px] font-mono text-[7px] font-bold leading-none bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-fg-secondary">
        {fileIcon(ext)}
      </span>
      <span className="text-fg-primary leading-none">{basename}</span>
      <span className="text-fg-muted leading-none">+{entry.lineCount}</span>
    </span>
  );
}
