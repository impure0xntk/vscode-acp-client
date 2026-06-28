import React, { useCallback, useState, useEffect, useMemo } from "react";
import { createTwoFilesPatch, parsePatch } from "diff";
import type { FileEditEntry } from "../../pipeline/types";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { useFileWriteStore } from "../../store/fileWriteStore";
import type { ContextAttachment } from "../../types";
import { FileIcon, getFileExtension } from "../primitives";

export interface FileEditSummaryProps {
  entries: FileEditEntry[];
  sessionId?: string;
  agentId?: string;
  onAttachDiff?: (attachment: ContextAttachment) => void;
}

type RowStatus = "modified" | "stale";

interface RowState {
  expanded: boolean;
  status: RowStatus;
}

function buildUnifiedDiff(
  original: string | null,
  filePath: string,
  writtenContent: string | null,
): string {
  const origSrc = original ?? "";
  const newSrc = writtenContent ?? "";
  // Use Myers algorithm via `diff` package for accurate line-level diff
  return createTwoFilesPatch(filePath, filePath, origSrc, newSrc, undefined, undefined, {
    context: 3,
  });
}

interface DiffLine {
  /** "|" = context, "+" = addition, "-" = deletion, "@@" = hunk header */
  type: "|" | "+" | "-" | "@@";
  /** Display text (without leading +/-/space prefix) */
  text: string;
  /** Old file line number (1-based; undefined for additions) */
  oldLine?: number;
  /** New file line number (1-based; undefined for deletions) */
  newLine?: number;
  /** Hunk header content, e.g. "@@ -10,6 +10,8 @@" */
  hunkHeader?: string;
}

/**
 * Parse a unified-diff string into structured lines for rendering.
 * Filters out redundant `Index:`, `---`, `+++` lines (file path already in row header).
 * Preserves `@@` hunk headers with line-number context, styled separately.
 */
function parseDiffForRender(diffText: string): DiffLine[] | null {
  try {
    const lines: DiffLine[] = [];
    const files = parsePatch(diffText);

    if (files.length === 0) return null;

    for (const file of files) {
      for (const hunk of file.hunks) {
        const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
        lines.push({ type: "@@", text: header, hunkHeader: header });

        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        for (const l of hunk.lines) {
          if (l.startsWith("+")) {
            lines.push({ type: "+", text: l.slice(1), newLine: newLine++ });
          } else if (l.startsWith("-")) {
            lines.push({ type: "-", text: l.slice(1), oldLine: oldLine++ });
          } else if (l.startsWith(" ")) {
            lines.push({ type: "|", text: l.slice(1), oldLine: oldLine++, newLine: newLine++ });
          } else if (l.startsWith("@@")) {
            lines.push({ type: "@@", text: l, hunkHeader: l });
          }
          // Skip "\ No newline at end of file"
        }
      }
    }
    return lines;
  } catch {
    return null;
  }
}

export function FileEditSummary({
  entries,
  sessionId,
  agentId,
  onAttachDiff,
}: FileEditSummaryProps): React.ReactElement | null {
  const [collapsed, setCollapsed] = useState(false);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  if (entries.length === 0) return null;

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const toggleRow = useCallback((path: string) => {
    setRowStates((prev) => {
      const cur = prev[path];
      if (cur) {
        return { ...prev, [path]: { ...cur, expanded: !cur.expanded } };
      }
      return { ...prev, [path]: { expanded: true, status: "modified" } };
    });
  }, []);

  const setRowStatus = useCallback((path: string, status: RowStatus) => {
    setRowStates((prev) => ({
      ...prev,
      [path]: { ...(prev[path] ?? { expanded: false, status: "modified" }), status },
    }));
  }, []);

  const totalLines = entries.reduce((s, e) => s + e.lineCount, 0);
  const totalDeleted = entries.reduce((s, e) => s + e.deletedLines, 0);

  return (
    <div className="ml-4 mr-1 mt-1 mb-1 rounded-md border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[color-mix(in_srgb,var(--bg-secondary)_8%,transparent)] overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-2.5 py-[5px] bg-transparent border-none cursor-pointer text-left transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
        onClick={toggleCollapse}
        aria-expanded={!collapsed}
      >
        <span className="text-[10px] text-fg-muted flex-shrink-0 transition-transform duration-150" style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }} aria-hidden="true">▼</span>
        <span className="text-[11px] font-medium text-fg-secondary flex-shrink-0">Files changed</span>
        <span className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-[5px] rounded-[8px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[10px] font-mono font-semibold text-accent flex-shrink-0">
          {entries.length}
        </span>
        <span className="text-[10px] font-mono text-fg-muted flex-shrink-0">
          <span className="text-success">+{totalLines}</span>
          {totalDeleted > 0 && <span className="text-error"> -{totalDeleted}</span>}
        </span>
      </button>

      {/* Rows */}
      {!collapsed && (
        <div className="border-t border-[color-mix(in_srgb,var(--border)_40%,transparent)]">
          {entries.map((entry, idx) => (
            <FileEditRow
              key={`${entry.path}-${idx}`}
              entry={entry}
              state={rowStates[entry.path] ?? { expanded: false, status: "modified" }}
              onToggle={() => toggleRow(entry.path)}
              onSetStatus={setRowStatus}
              sessionId={sessionId}
              agentId={agentId}
              onAttachDiff={onAttachDiff}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileEditRowProps {
  entry: FileEditEntry;
  state: RowState;
  onToggle: () => void;
  onSetStatus: (path: string, status: RowStatus) => void;
  sessionId?: string;
  agentId?: string;
  onAttachDiff?: (attachment: ContextAttachment) => void;
}

function FileEditRow({
  entry,
  state,
  onToggle,
  onSetStatus,
  sessionId,
  agentId,
  onAttachDiff,
}: FileEditRowProps): React.ReactElement {
  const basename = entry.path.split("/").pop() ?? entry.path;
  const dirPath = entry.path.slice(0, -(basename.length + 1));
  const isExpanded = state.expanded;
  const isStale = state.status === "stale";

  const storedOriginal = useFileWriteStore((s) => {
    if (!agentId || !sessionId) return null;
    return s.getOriginalContent(agentId, sessionId, entry.path);
  });
  const originalContent = entry.originalContent ?? storedOriginal;

  // Stale detection
  useEffect(() => {
    if (!agentId || !sessionId) return;
    const storedHash = useFileWriteStore.getState().getLastWriteHash(agentId, sessionId, entry.path);
    if (!storedHash) return;

    const msgId = `checkHash:${entry.path}:${Date.now()}`;
    const handler = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown>;
      if (data.type === "hashCheckResult" && data.msgId === msgId) {
        const stale = data.isStale as boolean;
        if (stale) {
          onSetStatus(entry.path, "stale");
        }
        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);
    try {
      getVsCodeApi().postMessage({
        type: "checkFileHash",
        msgId,
        path: entry.path,
        expectedHash: storedHash,
      });
    } catch { /* vscodeApi not available */ }
    return () => window.removeEventListener("message", handler);
  }, [agentId, sessionId, entry.path, onSetStatus]);

  const handleOpenFile = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        getVsCodeApi().postMessage({ type: "openFile", path: entry.path });
      } catch { /* vscodeApi not available */ }
    },
    [entry.path],
  );

  const handleOpenDiff = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const storedHash = useFileWriteStore.getState().getLastWriteHash(
          agentId ?? "",
          sessionId ?? "",
          entry.path,
        );
        getVsCodeApi().postMessage({
          type: "openDiff",
          path: entry.path,
          agentId,
          sessionId,
          originalContent: originalContent ?? undefined,
          expectedHash: storedHash ?? undefined,
        });
      } catch { /* vscodeApi not available */ }
    },
    [entry.path, agentId, sessionId, originalContent],
  );

  const handleAttachDiff = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!agentId || !sessionId || !onAttachDiff) return;
      const diffContent = buildUnifiedDiff(originalContent ?? "", entry.path, entry.writtenContent ?? null);
      const labelSuffix = entry.deletedLines > 0
        ? ` (+${entry.lineCount} -${entry.deletedLines})`
        : ` (+${entry.lineCount})`;
      const attachment: ContextAttachment = {
        id: `diff:${entry.path}:${Date.now()}`,
        type: "diff",
        path: entry.path,
        label: `${basename}${labelSuffix}`,
        lineRange: undefined,
        tokenCount: Math.ceil(diffContent.length / 4),
        content: diffContent,
      };
      onAttachDiff(attachment);
    },
    [agentId, sessionId, entry, originalContent, basename, onAttachDiff],
  );

  const handleRevert = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!agentId || !sessionId) return;
      if (!originalContent) return;
      try {
        getVsCodeApi().postMessage({
          type: "revertFile",
          path: entry.path,
          agentId,
          sessionId,
          originalContent,
        });
      } catch { /* vscodeApi not available */ }
    },
    [agentId, sessionId, entry.path, originalContent],
  );

  const canRevert = originalContent != null;
  const diffContent = useMemo(
    () => isExpanded
      ? buildUnifiedDiff(originalContent ?? "", entry.path, entry.writtenContent ?? null)
      : "",
    [isExpanded, originalContent, entry.path, entry.writtenContent],
  );
  const parsedDiffLines = useMemo(
    () => isExpanded ? parseDiffForRender(diffContent) : null,
    [isExpanded, diffContent],
  );

  return (
    <div className="border-b border-[color-mix(in_srgb,var(--border)_20%,transparent)] last:border-b-0">
      {/* Row header */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-[4px] cursor-pointer select-none transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]${isStale ? " bg-[color-mix(in_srgb,var(--warning)_6%,transparent)]" : ""}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        title={entry.path}
      >
        {/* Status indicator */}
        <span
          className={`w-[3px] h-[14px] rounded-full flex-shrink-0 ${isStale ? "bg-warning" : "bg-success"}`}
          aria-hidden="true"
        />

        {/* File icon badge */}
        <FileIcon path={entry.path} />

        {/* Path */}
        <span className="flex-1 min-w-0 flex items-baseline gap-0.5 text-[11px] leading-tight">
          <span className="text-fg-primary font-medium truncate">{basename}</span>
          {dirPath && (
            <span className="text-fg-muted truncate text-[10px]">{dirPath}/</span>
          )}
        </span>

        {/* Line count badge */}
        <span className="inline-flex items-center gap-0.5 flex-shrink-0">
          <span className="text-[10px] font-mono font-semibold text-success">+{entry.lineCount}</span>
          {entry.deletedLines > 0 && (
            <span className="text-[10px] font-mono font-semibold text-error">-{entry.deletedLines}</span>
          )}
        </span>

        {/* Stale indicator */}
        {isStale && (
          <span
            className="inline-flex items-center justify-center w-[16px] h-[16px] text-[10px] flex-shrink-0 text-warning"
            title="File has been modified since the agent wrote it"
            aria-label="File modified externally"
          >
            ⚠
          </span>
        )}

        {/* Action buttons */}
        <span className="inline-flex items-center gap-px flex-shrink-0">
          <button
            className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 rounded-[3px] bg-transparent text-fg-muted text-[11px] cursor-pointer border-none hover:bg-accent-hover hover:text-fg-primary transition-all"
            onClick={handleOpenFile}
            title="Open file"
            aria-label="Open file"
          >
            ↗
          </button>
          <button
            className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 rounded-[3px] bg-transparent text-fg-muted text-[11px] cursor-pointer border-none hover:bg-accent-hover hover:text-fg-primary transition-all"
            onClick={handleOpenDiff}
            title="Open diff in editor"
            aria-label="Open diff in editor"
          >
            ⇔
          </button>
          {onAttachDiff && (
            <button
              className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 rounded-[3px] bg-transparent text-fg-muted text-[11px] cursor-pointer border-none hover:bg-accent-hover hover:text-fg-primary transition-all"
              onClick={handleAttachDiff}
              title="Attach diff to message"
              aria-label="Attach diff to message"
            >
              📎
            </button>
          )}
        </span>
      </div>

      {/* Inline diff expansion */}
      {isExpanded && (
        <div className="border-t border-[color-mix(in_srgb,var(--border)_30%,transparent)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)]">
          {/* Diff toolbar */}
          <div className="flex items-center justify-between px-2.5 py-[3px] border-b border-[color-mix(in_srgb,var(--border)_20%,transparent)]">
            <span className="text-[9px] font-mono text-fg-muted uppercase tracking-wide">Diff preview</span>
            <div className="flex items-center gap-1">
              {canRevert && (
                <button
                  className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded-[3px] bg-[color-mix(in_srgb,var(--error)_10%,transparent)] text-error text-[9px] font-medium cursor-pointer border border-[color-mix(in_srgb,var(--error)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--error)_20%,transparent)] transition-all"
                  onClick={handleRevert}
                  title="Revert this file to the original content before the agent wrote it"
                  aria-label="Revert changes"
                >
                  ↩ Revert
                </button>
              )}
            </div>
          </div>
          {/* Diff content — hunk-aware with line numbers */}
          {isExpanded && (
            <pre className="px-2.5 py-2 m-0 font-mono text-[10px] leading-[1.5] overflow-x-auto max-h-[240px] overflow-y-auto whitespace-pre text-fg-secondary">
              {parsedDiffLines === null ? (
                <div className="text-fg-muted text-[10px] opacity-60 px-1 py-2">(Unable to parse diff output)</div>
              ) : parsedDiffLines.map((dl, i) => {
                if (dl.type === "@@") {
                  return (
                    <div
                      key={i}
                      className="px-1 py-[1px] my-[1px] text-[9px] font-medium tracking-wide bg-[color-mix(in_srgb,var(--fg-muted)_8%,transparent)] text-fg-muted"
                    >
                      {dl.hunkHeader}
                    </div>
                  );
                }
                const prefix = dl.type === "+" ? "+" : dl.type === "-" ? "-" : " ";
                return (
                  <div
                    key={i}
                    className={
                      dl.type === "-"
                        ? "bg-[rgba(241,76,76,0.10)] text-[#f48771]"
                        : dl.type === "+"
                          ? "bg-[rgba(78,201,176,0.10)] text-[#89d185]"
                          : ""
                    }
                  >
                    <span className="inline-block w-[3.5ch] text-right pr-[0.5ch] select-none opacity-40 font-mono">{dl.oldLine ?? ""}</span>
                    <span className="inline-block w-[3.5ch] text-right pr-[0.5ch] select-none opacity-40 font-mono">{dl.newLine ?? ""}</span>
                    <span className="inline-block w-3 select-none opacity-60">{prefix}</span>
                    <span>{dl.text}</span>
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
