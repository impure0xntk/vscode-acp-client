import React, { useCallback, useMemo } from "react";
import { renderMarkdown, type RenderContext } from "../lib/markdown";
import { getVsCodeApi } from "../lib/vscodeApi";
import { Icon, iconForType } from "../lib/icons";
import { ToolBatchSummary } from "./ToolCallCard/ToolBatchSummary";
import { ToolCallCard } from "./ToolCallCard";
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
    if (attachment.type === "selection" || attachment.type === "symbol" || !attachment.path) return;
    try { getVsCodeApi().postMessage({ type: "openFile", path: attachment.path, line: attachment.lineRange?.[0] }); }
    catch { /* */ }
  }, [attachment]);

  const typeLabel =
    attachment.type === "selection" ? "selection"
    : attachment.type === "diff" ? "diff"
    : attachment.type === "symbol" ? "symbol"
    : (attachment.path.split("/").pop() ?? attachment.path);

  const isNavigable = attachment.type !== "selection" && attachment.type !== "symbol" && !!attachment.path;

  return (
    <span
      className={`user-attach-chip${isNavigable ? " user-attach-chip--link" : ""}`}
      onClick={isNavigable ? handleClick : undefined}
      title={
        attachment.type === "selection" ? `Selection in ${attachment.path}${attachment.lineRange ? `:${attachment.lineRange[0]}-${attachment.lineRange[1]}` : ""}`
        : attachment.type === "symbol" ? attachment.label
        : attachment.type === "diff" ? attachment.label
        : attachment.path
      }
      role={isNavigable ? "button" : undefined}
      tabIndex={isNavigable ? 0 : undefined}
      onKeyDown={isNavigable ? (e) => { if (e.key === "Enter") handleClick(); } : undefined}
    >
      <Icon name={iconForType(attachment.type)} size="sm" className="user-attach-chip-icon" />
      <span className="user-attach-chip-label">{typeLabel}</span>
      <span className="user-attach-chip-tokens">{attachment.tokenCount}t</span>
    </span>
  );
}

export const Message = React.memo(function Message({
  id, role, content, timestamp, toolCalls, thinking, inlineFilePaths, attachments, isConsecutive, sessionId, compressionInfo,
}: MessageProps): React.ReactElement {
  const time = new Date(timestamp).toLocaleTimeString();
  const isSystem = role === "system";
  const isUser = role === "user";
  const isCompression = isSystem && compressionInfo !== undefined;
  const hasToolCalls = toolCalls !== undefined && toolCalls.length > 0;
  const hasAttachments = isUser && attachments !== undefined && attachments.length > 0;

  const renderCtx: RenderContext | undefined = inlineFilePaths?.length
    ? { filePaths: new Set(inlineFilePaths) }
    : undefined;

  const handleMarkdownClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const copyBtn = (e.target as HTMLElement).closest('[data-action="copy"]');
    if (copyBtn) { copyCodeBlock(e as React.MouseEvent<HTMLElement>); return; }
    openFileFromLink(e);
  }, []);

  const batchCalls = useMemo(() => {
    if (!hasToolCalls) return undefined;
    return toolCalls!.map((tc) => ({
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
  }, [hasToolCalls, toolCalls]);

  return (
    <div
      className={`message ${isSystem ? "message-system" : isUser ? "message-user" : "message-agent"}`}
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
              <MessageActions messageId={id} content={content} isUserMessage={isUser} sessionId={sessionId ?? ""} />
            </div>
          )}
        </div>
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
