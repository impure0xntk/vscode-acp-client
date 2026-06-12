import React, { useCallback, useMemo, useRef, useEffect } from "react";
import { renderMarkdown, type RenderContext } from "../lib/markdown";
import { getVsCodeApi } from "../lib/vscodeApi";
import { ToolCallCard, GroupedToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import type { ChatMessage, ToolCall, ContextAttachment } from "../types";

export interface MessageProps {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: ChatMessage["toolCalls"];
  thinking?: ChatMessage["thinking"];
  inlineFilePaths?: string[];
  attachments?: ContextAttachment[];
  /** When true, the header (name + timestamp) is hidden for consecutive same-speaker messages */
  isConsecutive?: boolean;
  /** Session ID for actions like fork */
  sessionId?: string;
}

/** Open a file in VS Code editor from a click on an inline-code link */
function openFileFromLink(e: React.MouseEvent<HTMLElement>): void {
  const target = e.target as HTMLElement;
  const anchor = target.closest("[data-file-path]") as HTMLElement | null;
  if (!anchor) return;
  e.preventDefault();
  e.stopPropagation();
  const filePath = anchor.dataset.filePath;
  if (!filePath) return;
  const lineAttr = anchor.dataset.fileLine;
  const line = lineAttr ? Number(lineAttr) : undefined;
  try {
    getVsCodeApi().postMessage({ type: "openFile", path: filePath, line });
  } catch { /* vscodeApi not available */ }
}

/** Copy code block content to clipboard */
function copyCodeBlock(e: React.MouseEvent<HTMLElement>): void {
  const btn = e.currentTarget as HTMLElement;
  const wrapper = btn.closest(".code-block-wrapper") as HTMLElement | null;
  if (!wrapper) return;
  const codeEl = wrapper.querySelector("code");
  if (!codeEl) return;
  const text = codeEl.textContent ?? "";
  e.preventDefault();
  e.stopPropagation();

  const showCopied = () => {
    btn.setAttribute("data-copied", "true");
    setTimeout(() => btn.removeAttribute("data-copied"), 1500);
  };

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(showCopied).catch(() => {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showCopied();
    });
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showCopied();
  }
}

/** Derive a grouping key from kind or title */
function effectiveKind(tc: ToolCall): string {
  if (tc.kind && tc.kind.trim()) return tc.kind.trim();
  return "tool_call";
}

/** Group tool calls by kind using a Map (order may change — that's fine) */
function groupToolCalls(toolCalls: ToolCall[]): Array<{ kind: string; count: number; calls: ToolCall[] }> {
  const groups: Map<string, ToolCall[]> = new Map();
  for (const tc of toolCalls) {
    const key = effectiveKind(tc);
    const list = groups.get(key) ?? [];
    list.push(tc);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).map(([kind, calls]) => ({
    kind,
    count: calls.length,
    calls,
  }));
}

function AttachmentChip({ attachment }: { attachment: ContextAttachment }): React.ReactElement {
  const handleClick = useCallback(() => {
    if (attachment.type === "selection" || attachment.type === "symbol" || !attachment.path) return;
    try {
      getVsCodeApi().postMessage({
        type: "openFile",
        path: attachment.path,
        line: attachment.lineRange?.[0],
      });
    } catch { /* vscodeApi not available */ }
  }, [attachment]);

  const typeLabel = attachment.type === "selection" ? "selection"
    : attachment.type === "diff" ? "diff"
    : attachment.type === "symbol" ? "symbol"
    : (attachment.path.split("/").pop() ?? attachment.path);

  const isNavigable = attachment.type !== "selection" && attachment.type !== "symbol" && !!attachment.path;

  return (
    <span
      className={`user-attach-chip${isNavigable ? " user-attach-chip--link" : ""}`}
      onClick={isNavigable ? handleClick : undefined}
      title={
        attachment.type === "selection"
          ? `Selection in ${attachment.path}${attachment.lineRange ? `:${attachment.lineRange[0]}-${attachment.lineRange[1]}` : ""}`
          : attachment.type === "symbol"
          ? attachment.label
          : attachment.type === "diff"
          ? attachment.label
          : attachment.path
      }
      role={isNavigable ? "button" : undefined}
      tabIndex={isNavigable ? 0 : undefined}
      onKeyDown={isNavigable ? (e) => { if (e.key === "Enter") handleClick(); } : undefined}
    >
      <span className="user-attach-chip-icon">{attachIcon(attachment.type)}</span>
      <span className="user-attach-chip-label">{typeLabel}</span>
      <span className="user-attach-chip-tokens">{attachment.tokenCount}t</span>
    </span>
  );
}

function attachIcon(type: ContextAttachment["type"]): string {
  switch (type) {
    case "file": return "📄";
    case "selection": return "✂️";
    case "symbol": return "🔷";
    case "diff": return "📋";
  }
}

function FileChip({ path, line }: { path: string; line?: number }): React.ReactElement {
  const handleClick = useCallback(() => {
    try {
      getVsCodeApi().postMessage({ type: "openFile", path, line });
    } catch { /* vscodeApi not available */ }
  }, [path, line]);

  const label = line ? `${path}:${line}` : path;
  const basename = path.split("/").pop() ?? path;

  return (
    <span
      className="file-chip"
      onClick={handleClick}
      title={label}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") handleClick(); }}
    >
      <span className="file-chip-icon">📄</span>
      <span className="file-chip-label">{basename}{line ? `:${line}` : ""}</span>
    </span>
  );
}

export const Message = React.memo(function Message({
  id,
  role,
  content,
  timestamp,
  toolCalls,
  thinking,
  inlineFilePaths,
  attachments,
  isConsecutive,
  sessionId,
}: MessageProps): React.ReactElement {
  const time = new Date(timestamp).toLocaleTimeString();

  // Collect unique locations from all tool calls
  const locations = toolCalls
    ?.flatMap((tc) => tc.locations ?? [])
    .filter(
      (loc, idx, arr) =>
        arr.findIndex((l) => l.path === loc.path && l.line === loc.line) === idx
    );

  const isTool = role === "tool";
  const isSystem = role === "system";
  const isUser = role === "user";
  const hasExtra = (locations && locations.length > 0) || (toolCalls && toolCalls.length > 0);
  const hasAttachments = isUser && attachments !== undefined && attachments.length > 0;

  // Tool messages: left-aligned card without speech bubble
  // Group all calls by kind — each ChatMessage already contains same-kind calls
  // (grouped by the extension host), but apply threshold for GroupedToolCallCard
  const GROUP_THRESHOLD = 2;
  const groupedCalls = useMemo(
    () => toolCalls && toolCalls.length >= GROUP_THRESHOLD ? groupToolCalls(toolCalls) : null,
    [toolCalls],
  );

  if (isTool) {
    return (
      <div className="message message-tool" data-message-id={id} data-role={role}>
        {groupedCalls ? (
          groupedCalls.map((group) =>
            group.count >= GROUP_THRESHOLD ? (
              <GroupedToolCallCard
                key={group.kind}
                kind={group.kind}
                count={group.count}
                calls={group.calls.map((tc) => ({
                  id: tc.id,
                  title: tc.title,
                  kind: tc.kind,
                  status: tc.status,
                  input: tc.input,
                  output: tc.output ?? tc.content?.map((c) => c.text).join("\n"),
                  durationMs: tc.durationMs,
                  locations: tc.locations,
                  diffContent: tc.diffContent,
                }))}
              />
            ) : (
              group.calls.map((tc) => (
                <ToolCallCard
                  key={tc.id}
                  id={tc.id}
                  title={tc.title}
                  kind={tc.kind}
                  status={tc.status}
                  input={tc.input}
                  output={tc.output ?? tc.content?.map((c) => c.text).join("\n")}
                  durationMs={tc.durationMs}
                  locations={tc.locations}
                  diffContent={tc.diffContent}
                />
              ))
            )
          )
        ) : (
          toolCalls?.map((tc) => (
            <ToolCallCard
              key={tc.id}
              id={tc.id}
              title={tc.title}
              kind={tc.kind}
              status={tc.status}
              input={tc.input}
              output={tc.output ?? tc.content?.map((c) => c.text).join("\n")}
              durationMs={tc.durationMs}
              locations={tc.locations}
              diffContent={tc.diffContent}
            />
          ))
        )}
      </div>
    );
  }

  // Build render context from confirmed inline file paths
  const renderCtx: RenderContext | undefined = inlineFilePaths?.length
    ? { filePaths: new Set(inlineFilePaths) }
    : undefined;

  /** Delegate clicks: copy button or file link */
  const handleMarkdownClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // Copy button takes priority
      const copyBtn = (e.target as HTMLElement).closest('[data-action="copy"]');
      if (copyBtn) {
        copyCodeBlock(e as React.MouseEvent<HTMLElement>);
        return;
      }
      openFileFromLink(e);
    },
    [],
  );

  // System / user / agent messages
  return (
    <div
      className={`message ${isSystem ? "message-system" : isUser ? "message-user" : "message-agent"}`}
      data-message-id={id}
      data-role={role}
    >
      {hasExtra && (
        <>
          {/* File chips above messages */}
          {locations && locations.length > 0 && (
            <div className="message-file-chips">
              {locations.map((loc, idx) => (
                <FileChip key={`${loc.path}:${loc.line ?? 0}-${idx}`} path={loc.path} line={loc.line} />
              ))}
            </div>
          )}
          {toolCalls?.map((tc) => (
            <ToolCallCard
              key={tc.id}
              id={tc.id}
              title={tc.title}
              kind={tc.kind}
              status={tc.status}
              input={tc.input}
              output={tc.output ?? tc.content?.map((c) => c.text).join("\n")}
              durationMs={tc.durationMs}
              locations={tc.locations}
              diffContent={tc.diffContent}
            />
          ))}
        </>
      )}
      {hasAttachments && (
        <div className="user-attach-row">
          {attachments!.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
        </div>
      )}
      {!isConsecutive && (
        <div className="message-header">
          <span className="message-role">
            {isSystem ? "System" : isUser ? "You" : "Agent"}
          </span>
          <span className="message-time">{time}</span>
        </div>
      )}
      <div className="message-body">
        {isUser ? (
          <div className="message-text">{content}</div>
        ) : (
          <div
            className={`message-markdown${isSystem ? " message-system-markdown" : ""}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content, renderCtx) }}
            onClick={handleMarkdownClick}
          />
        )}
      </div>
      {thinking && (
        <ThinkingBlock
          content={thinking.content}
          isStreaming={thinking.isStreaming}
        />
      )}
      {!isTool && (
        <MessageActions
          messageId={id}
          content={content}
          isUserMessage={isUser}
          sessionId={sessionId ?? ""}
        />
      )}
    </div>
  );
});
