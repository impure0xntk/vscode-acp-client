import React, { useCallback, useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { Icon } from "../../lib/icons";
import { ToolBatchSummary } from "./ToolBatchSummary";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageActions } from "./MessageActions";
import { usePathResolutionStore } from "../../store/pathResolutionStore";
import { sessionKeyOf } from "../../store/sessionStore";
import type { ChatDisplayItem } from "../../pipeline";

export interface MessageProps {
  /** Chat-type PipelineItem — only standard chat messages reach this component */
  item: ChatDisplayItem;
  isConsecutive: boolean;
  sessionId?: string;
  agentId?: string;
  /** When true, always show the message header regardless of isConsecutive */
  forceHeader?: boolean;
  /** When true, apply appear animation (only for newly added messages) */
  isNew?: boolean;
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
  const wrapper = btn.closest("[data-code-block-wrapper]") as HTMLElement | null;
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
      className="inline-flex items-center gap-[2px] px-[3px] py-[1px] rounded-[3px] bg-bg-secondary text-[9px] cursor-pointer select-none shrink-0 hover:bg-accent-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1"
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
        <Icon name="diff-single" size="sm" className="text-[12px]" />
      ) : attachment.type === "selection" ? (
        <Icon name="selection" size="sm" className="text-[12px]" />
      ) : attachment.type === "symbol" ? (
        <Icon name="symbol-class" size="sm" className="text-[12px]" />
      ) : (
        <span className="inline-flex items-center justify-center w-[14px] h-[11px] rounded-[2px] font-mono text-[7px] font-bold leading-[-0.3px] shrink-0 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-fg-secondary">{"•"}</span>
      )}
      <span className="leading-none text-fg-primary">
        {attachment.type === "selection"
          ? "selection"
          : attachment.type === "symbol"
            ? attachment.label
            : attachment.type === "diff"
              ? "diff"
              : (attachment.path.split("/").pop() ?? attachment.path)}
      </span>
      {attachment.type === "selection" && attachment.lineRange && (
        <span className="text-fg-muted text-[9px] ml-[2px]">
          :{attachment.lineRange[0]}-{attachment.lineRange[1]}
        </span>
      )}
      <span className="text-fg-muted text-[9px] ml-[2px]">{attachment.tokenCount}t</span>
    </span>
  );
}

export const Message = React.memo(function Message({
  item,
  isConsecutive,
  sessionId,
  agentId,
  forceHeader = false,
  isNew = false,
}: MessageProps): React.ReactElement {
  const {
    role,
    content,
    timestamp,
    resolvedToolCalls,
    attachments,
    thinking,
    renderContext,
  } = item;

  // Use sessionKey (agentId:sessionId) for path resolution lookup
  const sk = agentId && sessionId ? sessionKeyOf(agentId, sessionId) : "";
  const rawResolved = usePathResolutionStore(
    (state) => state.resolvedPaths[sk]
  );

  // Only use verified (resolved) paths — never unverified candidates from renderContext.
  // renderContext.filePaths contains speculative candidates extracted by pattern matching;
  // without FS verification they may point to non-existent files.
  const mergedContext = useMemo(
    () => ({
      filePaths: new Set<string>(rawResolved ?? []),
    }),
    [rawResolved]
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

  const animationClass = isNew ? "animate-message-appear" : "";

  return (
    <div
      className={`group flex flex-col gap-[2px] py-1 relative overflow-visible ${isSystem ? "opacity-70" : ""} ${animationClass}`}
      data-role={role}
      data-message-id={item.key}
    >
      {(!isConsecutive || forceHeader) && (
        <div className={`flex items-center gap-2 text-[11px] text-fg-muted mb-[2px] px-[2px] ${isUser ? "justify-end" : ""}`}>
          <span className="font-medium text-fg-secondary">
            {isSystem ? "System" : isUser ? "You" : "Agent"}
          </span>
          <span className="text-[10px] opacity-50">{time}</span>
        </div>
      )}
      <div className={`flex items-start gap-1.5 ${isUser ? "justify-end" : ""}`}>
        {isUser && (
          <div className="inline-flex items-center gap-1 opacity-0 invisible transition-opacity transition-visibility pointer-events-none shrink-0 self-center order-first group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto">
            <MessageActions
              messageId={item.key}
              content={content}
              isUserMessage={isUser}
              sessionId={sessionId ?? ""}
            />
          </div>
        )}
        {!isToolOnlyAgent && (
          <div className={`max-w-full ${isUser ? "bg-[color-mix(in_srgb,var(--user-bubble)_10%,transparent)] text-fg-primary px-[10px] py-1 rounded-lg border border-[color-mix(in_srgb,var(--user-bubble)_15%,transparent)] self-end max-w-[70%]" : "text-fg-primary"}`}>
            {isUser ? (
              <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.5]">{content}</div>
            ) : (
              <div className="flex items-start gap-1">
                <div
                  className={`leading-[1.6] min-w-0 flex-1 text-[13px]${isSystem ? " text-fg-secondary italic" : ""}`}
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
        <div className="flex flex-wrap gap-1 justify-end pt-0.5">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
        </div>
      )}
      {hasToolCalls && resolvedToolCalls && (
        <div className="ml-4 mr-1 mb-[2px]">
          <ToolBatchSummary
            calls={resolvedToolCalls}
            isNew={isNew}
          />
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
