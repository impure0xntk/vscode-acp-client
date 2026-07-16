import React, { useMemo } from "react";
import type { ContextAttachment } from "../../types";
import { renderMarkdown } from "../../lib/markdown";
import { Icon, iconForType } from "../../lib/icons";
import { attachmentLabel } from "../../lib/attachments";

export interface ContextPreviewProps {
  attachment: ContextAttachment;
  onClose: () => void;
}

/** Format a token count into a compact human-readable string. */
function formatTokens(n: number): string {
  const v = Math.max(0, Math.floor(n || 0));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/**
 * Preview pane shown above the Composer when a context attachment chip is
 * clicked. Renders the attachment content as markdown with syntax highlighting
 * and shows the token contribution at a glance.
 */
export function ContextPreview({
  attachment,
  onClose,
}: ContextPreviewProps): React.ReactElement {
  const html = useMemo(
    () => renderMarkdown(attachment.content),
    [attachment.content]
  );
  const iconName = iconForType(attachment.type);
  const label = attachmentLabel(attachment);

  return (
    <div
      className="context-preview mb-1 rounded-md border border-border bg-bg-secondary overflow-hidden"
      role="region"
      aria-label={`Context preview: ${label}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]">
        <Icon name={iconName} size="sm" className="text-[12px] shrink-0 text-fg-secondary" />
        <span
          className="text-[11px] font-medium text-fg-primary max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
          title={attachment.path}
        >
          {label}
        </span>
        <span className="text-[10px] text-fg-muted font-mono tabular-nums shrink-0">
          {formatTokens(attachment.tokenCount)} tokens
        </span>
        <button
          className="ml-auto inline-flex items-center justify-center w-4 h-4 p-0 border-none rounded-[2px] bg-transparent text-fg-muted text-[12px] leading-none cursor-pointer shrink-0 hover:bg-error hover:text-user-fg"
          onClick={onClose}
          title="Close preview"
          aria-label="Close preview"
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
      <div
        className="context-preview-body px-2.5 py-2 max-h-[200px] overflow-y-auto text-[12px] leading-[1.55] text-fg-primary font-ui"
        // Sanitized by renderMarkdown (DOMPurify) — content is agent-resolved
        // attachment text, not raw user DOM.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
