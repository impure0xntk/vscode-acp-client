import React, { useCallback, useState, useMemo } from "react";
import type { FileEditEntry } from "../../pipeline/types";
import { fileIcon, getFileExtension } from "./ToolCallCard";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { useFileWriteStore } from "../../store/fileWriteStore";
import { useSessionStore } from "../../store/sessionStore";
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
  const [showActions, setShowActions] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [showDiffPreview, setShowDiffPreview] = useState(false);

  const originalContent = useFileWriteStore((s) => {
    if (!agentId || !sessionId) return null;
    return s.getOriginalContent(agentId, sessionId, entry.path);
  });

  const handleOpenFile = useCallback(() => {
    try {
      getVsCodeApi().postMessage({ type: "openFile", path: entry.path });
    } catch { /* vscodeApi not available */ }
  }, [entry.path]);

  const handleRevert = useCallback(() => {
    if (!agentId || !sessionId) return;
    if (!confirmRevert) {
      setConfirmRevert(true);
      return;
    }
    // Send revert message to extension host
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
  }, [agentId, sessionId, entry, originalContent, basename, ext, onAttachDiff]);

  const handleShowDiff = useCallback(() => {
    setShowDiffPreview(!showDiffPreview);
  }, [showDiffPreview]);

  const handleOpenDiffEditor = useCallback(() => {
    try {
      getVsCodeApi().postMessage({
        type: "openDiff",
        path: entry.path,
        agentId,
        sessionId,
      });
    } catch { /* vscodeApi not available */ }
  }, [entry.path, agentId, sessionId]);

  const hasOriginal = originalContent != null;
  const canRevert = hasOriginal;
  const canAttachDiff = true;
  const canShowDiff = true;

  return (
    <span
      className="inline-flex items-center gap-0.5 px-[3px] py-px rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[9px] select-none transition-colors duration-150 hover:bg-accent-hover"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setConfirmRevert(false); }}
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

      {/* Action buttons — visible on hover */}
      {showActions && (
        <span className="inline-flex items-center gap-px ml-0.5">
          {/* Diff preview toggle */}
          {canShowDiff && (
            <button
              className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 rounded-[2px] bg-transparent text-fg-muted text-[8px] cursor-pointer border-none hover:bg-accent hover:text-user-fg transition-all"
              onClick={handleShowDiff}
              title="Preview diff"
              aria-label="Preview diff"
            >
              ±
            </button>
          )}

          {/* Open in diff editor */}
          {canShowDiff && (
            <button
              className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 rounded-[2px] bg-transparent text-fg-muted text-[8px] cursor-pointer border-none hover:bg-accent hover:text-user-fg transition-all"
              onClick={handleOpenDiffEditor}
              title="Open diff in editor"
              aria-label="Open diff in editor"
            >
              ⟷
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
      )}

      {/* Diff preview popover */}
      {showDiffPreview && originalContent != null && (
        <DiffPopover
          originalContent={originalContent}
          filePath={entry.path}
          basename={basename}
          onClose={() => setShowDiffPreview(false)}
          onOpenDiff={handleOpenDiffEditor}
        />
      )}
    </span>
  );
}

interface DiffPopoverProps {
  originalContent: string;
  filePath: string;
  basename: string;
  onClose: () => void;
  onOpenDiff: () => void;
}

function DiffPopover({ originalContent, filePath, basename, onClose, onOpenDiff }: DiffPopoverProps): React.ReactElement {
  const diffText = useMemo(() => {
    return `--- a/${basename}\n+++ b/${basename}\n@@ -1,${originalContent.split("\n").length} +1,modified @@\n${originalContent.split("\n").map((l) => `-${l}`).join("\n")}\n+... (modified content)`;
  }, [originalContent, basename]);

  return (
    <div className="absolute z-50 top-full left-0 mt-1 w-[320px] max-h-[200px] bg-bg-secondary border border-border rounded shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border-b border-border">
        <span className="text-[9px] font-mono text-fg-secondary truncate max-w-[200px]">{basename}</span>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex items-center justify-center w-4 h-4 p-0 rounded bg-transparent text-fg-muted text-[9px] cursor-pointer border-none hover:bg-accent hover:text-user-fg"
            onClick={onOpenDiff}
            title="Open in diff editor"
          >
            ⟷
          </button>
          <button
            className="inline-flex items-center justify-center w-4 h-4 p-0 rounded bg-transparent text-fg-muted text-[9px] cursor-pointer border-none hover:bg-accent hover:text-user-fg"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>
      <pre className="p-1.5 text-[9px] font-mono leading-[1.4] text-fg-secondary overflow-auto max-h-[160px] whitespace-pre-wrap break-all">
        {diffText.slice(0, 2000)}
      </pre>
    </div>
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
