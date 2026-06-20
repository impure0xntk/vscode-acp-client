import React, { useCallback, useState } from "react";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { getLogger } from "../../lib/logger";
import { IconCheck, IconCopy } from "../../lib/icons";

const log = getLogger("webview.component.MessageActions");

export interface MessageActionsProps {
  messageId: string;
  content: string;
  isUserMessage: boolean;
  sessionId: string;
}

export function MessageActions({
  content,
}: MessageActionsProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    try {
      getVsCodeApi().postMessage({ type: "copyToClipboard", text: content });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error("copy failed", { error: (err as Error).message });
    }
  }, [content]);

  return (
    <span
      className="inline-flex items-center gap-[2px] opacity-0 invisible transition-opacity transition-visibility shrink-0 leading-none self-center group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible"
      role="toolbar"
      aria-label="Message actions"
    >
      <button
        className="inline-flex items-center justify-center w-[22px] h-[22px] p-0 rounded-[4px] bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)] text-fg-muted cursor-pointer transition-colors hover:bg-accent-hover hover:text-fg-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px] shrink-0"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy to clipboard"}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </button>
    </span>
  );
}
