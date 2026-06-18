import React, { useCallback, useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { Icon } from "../../lib/icons";
import { ToolBatchSummary } from "./ToolBatchSummary";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import { usePathResolutionStore } from "../../store/pathResolutionStore";
import type { ChatDisplayItem } from "../../pipeline";

export interface MessageProps {
  /** Chat-type PipelineItem — only standard chat messages reach this component */
  item: ChatDisplayItem;
  isConsecutive: boolean;
  sessionId?: string;
}

function openFileFromLink(e: React.MouseEvent<HTMLElement>): void {
  const anchor = (e.target as HTMLElement).closest(
    "[data-file-path]"
  ) as HTMLElement | null;
  if (!anchor) return;
  e.preventDefault();
  e.stopPropagation();
  const filePath = anchor.dataset.filePath;
  if (!filePath) return;
  const line = anchor.dataset.fileLine
    ? Number(anchor.dataset.fileLine)
    : undefined;
  try {
    getVsCodeApi().postMessage({ type: "openFile", path: filePath, line });
  } catch {
    /* vscode API not available in test */
  }
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
    getVsCodeApi().postMessage({
      type: "copyToClipboard",
      text: codeEl.textContent ?? "",
    });
    btn.setAttribute("data-copied", "true");
    setTimeout(() => btn.removeAttribute("data-copied"), 1500);
  } catch {
    /* vscode API not available in test */
  }
}

function AttachmentChip({
  attachment,
}: {
  attachment: ChatDisplayItem["attachments"][number];
}): React.ReactElement {
  const isNavigable = attachment.isNavigable;

  const handleClick = useCallback(() => {
    if (!attachment.path) return;
    const line = attachment.lineRange?.[0];
    try {
      getVsCodeApi().postMessage({
        type: "openFile",
        path: attachment.path,
        line,
      });
    } catch {
      /* */
    }
  }, [attachment]);

  return (
    <span
      className="file-chip file-chip-inline"
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
        <span className="file-chip-ext">{"•"}</span>
      )}
      <span className="file-chip-label">
        {attachment.type === "selection"
          ? "selection"
          : attachment.type === "symbol"
            ? attachment.label
            : attachment.type === "diff"
              ? "diff"
              : (attachment.path.split("/").pop() ?? attachment.path)}
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
  item,
  isConsecutive,
  sessionId,
}: MessageProps): React.ReactElement {
  const { role, content, timestamp, resolvedToolCalls, attachments, thinking, renderContext } =
    item;

  const rawResolved = usePathResolutionStore(
    (state) => state.resolvedPaths[sessionId ?? ""]
  );

  const mergedContext = useMemo(
    () => ({
      filePaths: new Set<string>([
        ...(renderContext?.filePaths ?? []),
        ...(rawResolved ?? []),
      ]),
    }),
    [renderContext?.filePaths, rawResolved]
  );

  const time = new Date(timestamp ?? 0).toLocaleTimeString();
  const isSystem = role === "system";
  const isUser = role === "user";
  const isAgent = role === "agent";
  const hasToolCalls =
    resolvedToolCalls !== undefined && resolvedToolCalls.length > 0;
  const hasAttachments = isUser && attachments.length > 0;
  const hasContent = content.trim().length > 0;
  const isToolOnlyAgent = isAgent && hasToolCalls && !hasContent;

  const handleMarkdownClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const copyBtn = (e.target as HTMLElement).closest('[data-action="copy"]');
      if (copyBtn) {
        copyCodeBlock(e as React.MouseEvent<HTMLElement>);
        return;
      }
      openFileFromLink(e);
    },
    []
  );

  return (
    <div
      className={`message ${isSystem ? "message-system" : isUser ? "message-user" : "message-agent"}`}
      data-role={role}
      data-message-id={item.key}
    >
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
            <MessageActions
              messageId={item.key}
              content={content}
              isUserMessage={isUser}
              sessionId={sessionId ?? ""}
            />
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
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(content, mergedContext),
                  }}
                  onClick={handleMarkdownClick}
                />
                {!isSystem && (
                  <MessageActions
                    messageId={item.key}
                    content={content}
                    isUserMessage={isUser}
                    sessionId={sessionId ?? ""}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {hasAttachments && (
        <div className="user-attach-row">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
        </div>
      )}
      {hasToolCalls && resolvedToolCalls && (
        <div className="message-tool-batch">
          {resolvedToolCalls.length === 1 ? (
            <ToolCallCard {...resolvedToolCalls[0]} />
          ) : (
            <ToolBatchSummary calls={resolvedToolCalls} />
          )}
        </div>
      )}
      {thinking && (
        <ThinkingBlock
          content={thinking.content}
          isStreaming={thinking.isStreaming}
        />
      )}
    </div>
  );
});
