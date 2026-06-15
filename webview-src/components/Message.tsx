import React, { useCallback, useMemo } from "react";
import { renderMarkdown, type RenderContext } from "../lib/markdown";
import { getVsCodeApi } from "../lib/vscodeApi";
import { Icon, iconForType } from "../lib/icons";
import { ToolBatchSummary } from "./ToolCallCard/ToolBatchSummary";
import { ToolCallCard, getFileExtension, fileIcon } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import { ContextCompressionNotice } from "./ContextCompressionNotice";
import type { ChatMessage, ContextAttachment } from "../types";

export interface MessageProps {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: ChatMessage["toolCalls"];
  thinking?: ChatMessage["thinking"];
  inlineFilePaths?: string[];
  attachments?: ContextAttachment[];
  isConsecutive?: boolean;
  sessionId?: string;
  compressionInfo?: ChatMessage["compressionInfo"];
}

function openFileFromLink(e: React.MouseEvent<HTMLElement>): void {
  const anchor = (e.target as HTMLElement).closest("[data-file-path]") as HTMLElement | null;
  if (!anchor) return;
  e.preventDefault();
  e.stopPropagation();
  const filePath = anchor.dataset.filePath;
  if (!filePath) return;
  const line = anchor.dataset.fileLine ? Number(anchor.dataset.fileLine) : undefined;
  try { getVsCodeApi().postMessage({ type: "openFile", path: filePath, line }); }
  catch { /* */ }
}

function copyCodeBlock(e: React.MouseEvent<HTMLElement>): void {
  const btn = e.currentTarget as HTMLElement;
  const wrapper = btn.closest(".code-block-wrapper") as HTMLElement | null;
  if (!wrapper) return;
  const codeEl = wrapper.querySelector("code");
  if (!codeEl) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    getVsCodeApi().postMessage({ type: "copyToClipboard", text: codeEl.textContent ?? "" });
    btn.setAttribute("data-copied", "true");
    setTimeout(() => btn.removeAttribute("data-copied"), 1500);
  } catch { /* */ }
}

function AttachmentChip({ attachment }: { attachment: ContextAttachment }): React.ReactElement {
  const handleClick = useCallback(() => {
    if (!attachment.path) return;
    const line =
      attachment.type === "selection" || attachment.type === "symbol"
        ? attachment.lineRange?.[0]
        : attachment.lineRange?.[0];
    try {
      getVsCodeApi().postMessage({ type: "openFile", path: attachment.path, line });
    } catch {
      /* */
    }
  }, [attachment]);

  const isNavigable = !!attachment.path;

  // Label: file basename, or "selection", or "symbol", or "diff"
  const basename = attachment.path
    ? attachment.path.split("/").pop() ?? attachment.path
    : undefined;
  const ext = attachment.path ? getFileExtension(attachment.path) : "";

  // Detail: full path for file, line range for selection/symbol, label for diff
  const detail =
    attachment.type === "diff"
      ? attachment.label
      : attachment.lineRange
        ? `${basename}:${attachment.lineRange[0]}-${attachment.lineRange[1]}`
        : attachment.path ?? attachment.label;

  return (
    <span
      className={`file-chip file-chip-inline${isNavigable ? "" : ""}`}
      onClick={isNavigable ? handleClick : undefined}
      title={
        attachment.type === "diff"
          ? attachment.label
          : attachment.path
            ? attachment.lineRange
              ? `${attachment.path}:${attachment.lineRange[0]}-${attachment.lineRange[1]}`
              : attachment.path
            : attachment.label
      }
      role={isNavigable ? "button" : undefined}
      tabIndex={isNavigable ? 0 : undefined}
      onKeyDown={
        isNavigable
          ? (e) => {
              if (e.key === "Enter") handleClick();
            }
          : undefined
      }
    >
      {attachment.type === "diff" ? (
        <Icon name="diff-single" size="sm" className="file-chip-icon" />
      ) : attachment.type === "selection" ? (
        <Icon name="selection" size="sm" className="file-chip-icon" />
      ) : attachment.type === "symbol" ? (
        <Icon name="symbol-class" size="sm" className="file-chip-icon" />
      ) : (
        <span className="file-chip-ext">{fileIcon(ext)}</span>
      )}
      <span className="file-chip-label">
        {attachment.type === "selection"
          ? `selection`
          : attachment.type === "symbol"
            ? attachment.label
            : attachment.type === "diff"
              ? "diff"
              : basename}
      </span>
      {attachment.type === "selection" && attachment.lineRange && (
        <span className="file-chip-detail">
          :{attachment.lineRange[0]}-{attachment.lineRange[1]}
        </span>
      )}
      <span className="file-chip-tokens">{attachment.tokenCount}t</span>
    </span>
  );
}

export const Message = React.memo(function Message({
  id, role, content, timestamp, toolCalls, thinking, inlineFilePaths, attachments, isConsecutive, sessionId, compressionInfo,
}: MessageProps): React.ReactElement {
  const time = new Date(timestamp).toLocaleTimeString();
  const isSystem = role === "system";
  const isUser = role === "user";
  const isTool = role === "tool";
  const isAgent = role === "agent";
  const isCompression = isSystem && compressionInfo !== undefined;
  const hasToolCalls = toolCalls !== undefined && toolCalls.length > 0;
  const hasAttachments = isUser && attachments !== undefined && attachments.length > 0;
  const hasContent = content.trim().length > 0;
  // Agent messages with tool calls but no text content (e.g. tool-only turns)
  // should skip the markdown body to avoid empty whitespace.
  const isToolOnlyAgent = isAgent && hasToolCalls && !hasContent;

  const renderCtx: RenderContext | undefined = inlineFilePaths?.length
    ? { filePaths: new Set(inlineFilePaths) }
    : undefined;

  const handleMarkdownClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const copyBtn = (e.target as HTMLElement).closest('[data-action="copy"]');
    if (copyBtn) { copyCodeBlock(e as React.MouseEvent<HTMLElement>); return; }
    openFileFromLink(e);
  }, []);

  const batchCalls = useMemo(() => {
    if (!toolCalls || toolCalls.length === 0) return undefined;
    // Deduplicate by id — same tool call may arrive via multiple tool messages
    const seen = new Set<string>();
    return toolCalls.filter((tc) => {
      if (seen.has(tc.id)) return false;
      seen.add(tc.id);
      return true;
    }).map((tc) => ({
      id: tc.id,
      title: tc.title,
      kind: tc.kind,
      status: tc.status,
      input: tc.input,
      output: tc.output ?? tc.content?.map((c) => c.text).join("\n"),
      durationMs: tc.durationMs,
      locations: tc.locations,
      diffContent: tc.diffContent,
    }));
  }, [toolCalls]);

  return (
    <div
      className={`message ${isSystem ? "message-system" : isUser ? "message-user" : isTool ? "message-tool" : "message-agent"}`}
      data-message-id={id}
      data-role={role}
    >
      {hasAttachments && (
        <div className="user-attach-row">
          {attachments!.map((a) => <AttachmentChip key={a.id} attachment={a} />)}
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
      <div className={isUser ? "message-body-row" : ""}>
        {isUser && (
          <div className="message-user-actions">
            <MessageActions messageId={id} content={content} isUserMessage={isUser} sessionId={sessionId ?? ""} />
          </div>
        )}
        {!isToolOnlyAgent && (
          <div className="message-body">
            {isUser ? (
              <div className="message-text">{content}</div>
            ) : (
              <div className="message-markdown-wrap">
                <div
                  className={`message-markdown${isSystem ? " message-system-markdown" : ""}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(content, renderCtx) }}
                  onClick={handleMarkdownClick}
                />
                {!isSystem && !isTool && (
                  <MessageActions messageId={id} content={content} isUserMessage={isUser} sessionId={sessionId ?? ""} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {isCompression && compressionInfo && (
        <div className="message-compression">
          <ContextCompressionNotice compressionInfo={compressionInfo} />
        </div>
      )}
      {batchCalls && (
        <div className="message-tool-batch">
          {batchCalls.length === 1 ? (
            <ToolCallCard {...batchCalls[0]} />
          ) : (
            <ToolBatchSummary calls={batchCalls} />
          )}
        </div>
      )}
      {thinking && (
        <ThinkingBlock content={thinking.content} isStreaming={thinking.isStreaming} />
      )}
    </div>
  );
});
