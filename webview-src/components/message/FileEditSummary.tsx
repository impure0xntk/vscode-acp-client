import React, { useCallback, useState } from "react";
import type { FileEditEntry } from "../../pipeline/types";
import { fileIcon, getFileExtension } from "./ToolCallCard";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { useFileWriteStore } from "../../store/fileWriteStore";
import type { ContextAttachment } from "../../types";

export interface FileEditSummaryProps {
  entries: FileEditEntry[];
  /** Session ID for looking up original content */
  sessionId?: string;
  /** Agent ID for looking up original content */
  agentId?: string;
  /** Callback when user wants to attach a diff to the composer */
  onAttachDiff?: (attachment: ContextAttachment) => void;
}

export function FileEditSummary({ entries, sessionId, agentId, onAttachDiff }: FileEditSummaryProps): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <div className="ml-4 mr-1 mt-[2px] mb-[2px] px-1.25 py-[3px] rounded bg-[color-mix(in_srgb,var(--bg-secondary)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_15%,transparent)]">
      <div className="flex items-center gap-1 mb-[2px]">
        <span className="text-[9px] font-semibold uppercase text-fg-muted tracking-wide">Files edited</span>
        <span className="text-[9px] font-mono text-fg-muted">{entries.length}</span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {entries.map((entry, idx) => (
          <FileEditChip
            key={`${entry.path}-${idx}`}
            entry={entry}
            sessionId={sessionId}
            agentId={agentId}
            onAttachDiff={onAttachDiff}
          />
        ))}
      </div>
    </div>
  );
}

interface FileEditChipProps {
  entry: FileEditEntry;
  sessionId?: string;
  agentId?: string;
  onAttachDiff?: (attachment: ContextAttachment) => void;
}

function FileEditChip({ entry, sessionId, agentId, onAttachDiff }: FileEditChipProps): React.ReactElement {
  const ext = getFileExtension(entry.path);
  const basename = entry.path.split("/").pop() ?? entry.path;
  const [confirmRevert, setConfirmRevert] = useState(false);

  // Prefer originalContent from the entry (grouping.ts already retrieves it
  // from fileWriteStore), but also try the store directly as fallback.
  const storedOriginal = useFileWriteStore((s) => {
    if (!agentId || !sessionId) return null;
    return s.getOriginalContent(agentId, sessionId, entry.path);
  });
  const originalContent = entry.originalContent ?? storedOriginal;

  const handleOpenFile = useCallback(() => {
    try {
      getVsCodeApi().postMessage({ type: "openFile", path: entry.path });
    } catch { /* vscodeApi not available */ }
  }, [entry.path]);

  const handleRevert = useCallback(() => {
    if (!agentId || !sessionId) return;
    if (!confirmRevert) {
      setConfirmRevert(true);
      // Auto-dismiss confirm state after 3 seconds
      setTimeout(() => setConfirmRevert(false), 3000);
      return;
    }
    try {
      getVsCodeApi().postMessage({
        type: "revertFile",
        agentId,
        sessionId,
        path: entry.path,
      });
    } catch { /* vscodeApi not available */ }
    setConfirmRevert(false);
  }, [agentId, sessionId, entry.path, confirmRevert]);

  const handleAttachDiff = useCallback(() => {
    if (!agentId || !sessionId || !onAttachDiff) return;

    const diffContent = generateDiff(originalContent ?? "", entry.path, entry.lineCount);
    const attachment: ContextAttachment = {
      id: `diff:${entry.path}:${Date.now()}`,
      type: "diff",
      path: entry.path,
      label: `${basename} (${entry.lineCount} lines)`,
      lineRange: undefined,
      tokenCount: Math.ceil(diffContent.length / 4),
      content: diffContent,
    };
    onAttachDiff(attachment);
  }, [agentId, sessionId, entry, originalContent, basename, onAttachDiff]);

  const handleOpenDiffEditor = useCallback(() => {
    try {
      getVsCodeApi().postMessage({
        type: "openDiff",
        path: entry.path,
        agentId,
        sessionId,
        // Pass original content so the extension host can create a proper
        // untitled URI instead of relying on broken git-diff: scheme.
        originalContent: originalContent ?? undefined,
      });
    } catch { /* vscodeApi not available */ }
  }, [entry.path, agentId, sessionId, originalContent]);

  const canCompare = originalContent != null;
  const canRevert = originalContent != null;
  const canAttachDiff = true;

  return (
    <span
      className="inline-flex items-center gap-0.5 px-[3px] py-px rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[9px] select-none transition-colors duration-150 hover:bg-accent-hover"
      onMouseLeave={() => setConfirmRevert(false)}
      title={entry.path}
    >
      <span className="inline-flex items-center justify-center w-[13px] h-[10px] rounded-[2px] font-mono text-[7px] font-bold leading-none bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-fg-secondary">
        {fileIcon(ext)}
      </span>
      <span
        className="text-fg-primary leading-none cursor-pointer hover:underline"
        onClick={handleOpenFile}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") handleOpenFile(); }}
      >
        {basename}
      </span>
      <span className="text-fg-muted leading-none">+{entry.lineCount}</span>

      {/* Action buttons — always visible */}
      <span className="inline-flex items-center gap-px ml-0.5">
        {/* Open in diff editor (compare) */}
        {canCompare && (
          <button
            className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 rounded-[2px] bg-transparent text-fg-muted text-[8px] cursor-pointer border-none hover:bg-accent hover:text-user-fg transition-all"
            onClick={handleOpenDiffEditor}
            title="Compare changes"
            aria-label="Compare changes"
          >
            ⇔
          </button>
        )}

        {/* Attach diff to composer */}
        {canAttachDiff && onAttachDiff && (
          <button
            className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 rounded-[2px] bg-transparent text-fg-muted text-[8px] cursor-pointer border-none hover:bg-accent hover:text-user-fg transition-all"
            onClick={handleAttachDiff}
            title="Attach diff to message"
            aria-label="Attach diff to message"
          >
            📎
          </button>
        )}

        {/* Revert button */}
        {canRevert && (
          <button
            className={`inline-flex items-center justify-center w-[14px] h-[14px] p-0 rounded-[2px] bg-transparent text-[8px] cursor-pointer border-none transition-all ${
              confirmRevert
                ? "text-error bg-[color-mix(in_srgb,var(--error)_20%,transparent)] hover:bg-error hover:text-user-fg"
                : "text-fg-muted hover:bg-error hover:text-user-fg"
            }`}
            onClick={handleRevert}
            title={confirmRevert ? "Click again to confirm revert" : "Revert this file"}
            aria-label={confirmRevert ? "Confirm revert" : "Revert file"}
          >
            ↩
          </button>
        )}
      </span>
    </span>
  );
}

/**
 * Generate a unified diff string from original content and new content.
 */
function generateDiff(
  originalContent: string,
  filePath: string,
  lineCount: number
): string {
  const lines = originalContent.split("\n");
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  const hunkHeader = `@@ -1,${lines.length} +1,${lineCount} @@\n`;
  const removedLines = lines.map((l) => `-${l}`).join("\n");
  const placeholderAdded = `+... (${lineCount} lines written)`;
  return header + hunkHeader + removedLines + "\n" + placeholderAdded;
}
